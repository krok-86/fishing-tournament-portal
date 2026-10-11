const { randomUUID } = require("node:crypto");
const { Client, Pool } = require("pg");

const DEFAULT_URL = "postgres://127.0.0.1:5432/fishing_portal";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {import("pg").Pool | null} */
let pool = null;
let ready = false;
let setupError = "Архив ещё подключается к базе";

function connectionString() {
  const value = process.env.DATABASE_URL;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULT_URL;
}

function databaseName(url) {
  const match = /\/([^/?]+)(?:\?|$)/.exec(url);
  return match?.[1] ?? "";
}

function adminUrl(url) {
  return url.replace(/\/([^/?]+)(\?|$)/, "/postgres$2");
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function snapshotError(body) {
  if (!isRecord(body)) return "Снимок турнира пустой";
  const tournament = body.tournament;
  if (!isRecord(tournament)) return "Нет метаданных турнира";
  if (typeof tournament.id !== "string" || tournament.id.trim().length === 0 || tournament.id.length > 80) {
    return "Нет идентификатора турнира";
  }
  if (typeof tournament.name !== "string" || tournament.name.trim().length === 0 || tournament.name.length > 200) {
    return "Нет названия турнира";
  }
  if (typeof tournament.date !== "string" || tournament.date.length > 32) return "Нет даты турнира";
  if (!Array.isArray(body.participants) || body.participants.length > 500) return "Нет списка участников";
  if (!Array.isArray(body.finalStandings) || body.finalStandings.length === 0 || body.finalStandings.length > 500) {
    return "Нет финальной таблицы";
  }
  if (!Array.isArray(body.qualifyingLeaderboard) || body.qualifyingLeaderboard.length > 500) return "Нет таблицы отбора";
  if (!Array.isArray(body.catches) || body.catches.length > 20000) return "Нет лога поимок";
  if (!isRecord(body.playoff) || !Array.isArray(body.playoff.quarterfinals)) return "Нет сетки плей-офф";
  for (const row of body.finalStandings) {
    if (!isRecord(row) || typeof row.displayName !== "string" || typeof row.place !== "number") {
      return "Финальная таблица собрана не полностью";
    }
  }
  for (const event of body.catches) {
    if (!isRecord(event) || typeof event.type !== "string") return "Лог поимок собран не полностью";
  }
  return null;
}

async function ensureDatabase(url) {
  const name = decodeURIComponent(databaseName(url));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("Имя базы в DATABASE_URL должно состоять из латинских букв, цифр и _");
  }
  const admin = new Client({ connectionString: adminUrl(url) });
  await admin.connect();
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

async function ensureTable(nextPool) {
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_archives (
      id UUID PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      name TEXT NOT NULL,
      held_on DATE,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      snapshot JSONB NOT NULL
    )
  `);
}

async function prepareArchiveStore() {
  const url = connectionString();
  const nextPool = new Pool({ connectionString: url, max: 5 });
  nextPool.on("error", (error) => {
    console.error("Archive pool error:", error.message);
  });
  try {
    await ensureTable(nextPool);
  } catch (error) {
    await nextPool.end().catch(() => undefined);
    if (error && error.code === "3D000") {
      await ensureDatabase(url);
      const created = new Pool({ connectionString: url, max: 5 });
      created.on("error", (poolError) => {
        console.error("Archive pool error:", poolError.message);
      });
      await ensureTable(created);
      pool = created;
      ready = true;
      setupError = "";
      console.log("Tournament archive table is ready");
      return;
    }
    ready = false;
    setupError = "Нет соединения с PostgreSQL. Запустите базу и повторите.";
    console.error("Tournament archive is offline:", error instanceof Error ? error.message : error);
    return;
  }
  pool = nextPool;
  ready = true;
  setupError = "";
  console.log("Tournament archive table is ready");
}

function attachArchiveRoutes(app) {
  app.post("/api/tournaments/archive", async (req, res) => {
    if (!ready || !pool) {
      res.status(503).json({ ok: false, error: setupError });
      return;
    }
    const problem = snapshotError(req.body);
    if (problem) {
      res.status(400).json({ ok: false, error: problem });
      return;
    }

    const id = randomUUID();
    const tournament = req.body.tournament;
    const heldOn = /^\d{4}-\d{2}-\d{2}$/.test(tournament.date) ? tournament.date : null;
    try {
      const saved = await pool.query(
        `INSERT INTO tournament_archives (id, tournament_id, name, held_on, snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, archived_at`,
        [id, tournament.id.trim(), tournament.name.trim(), heldOn, JSON.stringify(req.body)],
      );
      const row = saved.rows[0];
      res.status(201).json({
        ok: true,
        id: row.id,
        path: `/archive/${row.id}`,
        archivedAt: row.archived_at,
      });
    } catch (error) {
      console.error("Archive insert failed:", error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, error: "Не удалось записать архив в базу" });
    }
  });

  app.get("/api/tournaments/archive/:id", async (req, res) => {
    if (!ready || !pool) {
      res.status(503).json({ ok: false, error: setupError });
      return;
    }
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!ID_RE.test(id)) {
      res.status(400).json({ ok: false, error: "Некорректная ссылка на архив" });
      return;
    }
    try {
      const found = await pool.query(
        "SELECT id, archived_at, snapshot FROM tournament_archives WHERE id = $1",
        [id],
      );
      const row = found.rows[0];
      if (!row) {
        res.status(404).json({ ok: false, error: "Такого архива нет" });
        return;
      }
      res.json({
        ok: true,
        id: row.id,
        archivedAt: row.archived_at,
        snapshot: row.snapshot,
      });
    } catch (error) {
      console.error("Archive read failed:", error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, error: "Не удалось прочитать архив" });
    }
  });
}

module.exports = { attachArchiveRoutes, prepareArchiveStore };
