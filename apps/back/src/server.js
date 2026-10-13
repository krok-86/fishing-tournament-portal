const express = require("express");
const { attachArchiveRoutes, prepareArchiveStore } = require("./archiveStore");
const { attachMatchRoutes } = require("./index.js"); // собран из index.ts: npm run build -w apps/back

const PORT = Number(process.env.PORT) || 3001;

/** Заявки живут в памяти процесса: до выезда их забирает ноутбук организатора. */
const participants = [];

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "4mb" }));
attachArchiveRoutes(app);

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function readFullName(body) {
  if (typeof body === "string") return normalizeName(body);
  if (!body || typeof body !== "object") return "";
  return normalizeName(body.fullName ?? body.name ?? body.displayName ?? "");
}

app.post("/api/register", (req, res) => {
  const fullName = readFullName(req.body);
  if (fullName.length < 3) {
    res.status(400).json({ ok: false, error: "Введите ФИО" });
    return;
  }
  if (fullName.length > 120) {
    res.status(400).json({ ok: false, error: "ФИО слишком длинное" });
    return;
  }

  const key = fullName.toLocaleLowerCase("ru");
  const existing = participants.find((item) => item.fullName.toLocaleLowerCase("ru") === key);
  if (existing) {
    res.json({ ok: true, fullName: existing.fullName, alreadyRegistered: true });
    return;
  }

  participants.push({ fullName, registeredAt: new Date().toISOString() });
  res.status(201).json({ ok: true, fullName, alreadyRegistered: false });
});

attachMatchRoutes(app);

app.get("/api/participants", (_req, res) => {
  res.json({
    participants: participants.map((item, index) => ({
      bibNumber: index + 1,
      fullName: item.fullName,
      displayName: item.fullName,
      groupId: "A",
      registeredAt: item.registeredAt,
    })),
  });
});

app.use((error, req, res, next) => {
  if (error && error.type === "entity.too.large") {
    res.status(413).json({ ok: false, error: "Снимок турнира слишком большой" });
    return;
  }
  if (error instanceof SyntaxError) {
    const message = req.path === "/api/register" ? "Не удалось прочитать ФИО" : "Не удалось прочитать запрос";
    res.status(400).json({ ok: false, error: message });
    return;
  }
  next(error);
});

void prepareArchiveStore();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Registration API listening on http://127.0.0.1:${PORT}`);
});
