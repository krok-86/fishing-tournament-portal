/**
 * Точка обмена уловами периода. Данные живут в памяти процесса:
 * перезапуск сервера их стирает, постоянной базы здесь нет.
 */
export const inMemoryMatches: Record<string, any> = {};

const MAX_FISH = 9999;
const QUALIFYING_PERIODS = 8;

type MatchStatus = "PENDING" | "CONFIRMED" | "CONFLICT";

interface SideReport {
  bibNumber: number;
  opponentBib: number | null;
  ownFish: number;
  opponentFish: number;
  reportedAt: string;
}

interface MemoryMatch {
  id: string;
  period: number;
  opponentBib: number | null;
  reports: Record<string, SideReport>;
  status: MatchStatus;
  updatedAt: string;
}

interface MatchApp {
  post(path: string, handler: (req: { body?: unknown }, res: MatchResponse) => void): void;
  get(path: string, handler: (req: unknown, res: MatchResponse) => void): void;
}

interface MatchResponse {
  status(code: number): { json(body: unknown): void };
  json(body: unknown): void;
  set(field: string, value: string): void;
}

function duelKey(period: number, bibNumber: number, opponentBib: number | null): string {
  if (opponentBib === null) return `${period}:${bibNumber}`;
  const low = Math.min(bibNumber, opponentBib);
  const high = Math.max(bibNumber, opponentBib);
  return `${period}:${low}-${high}`;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readReport(
  body: unknown,
): { ok: true; period: number; side: SideReport } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Пустой отчёт" };
  const record = body as {
    bibNumber?: unknown;
    period?: unknown;
    ownFish?: unknown;
    opponentFish?: unknown;
    opponentBib?: unknown;
  };
  const bibNumber = wholeNumber(record.bibNumber);
  const period = wholeNumber(record.period);
  const ownFish = wholeNumber(record.ownFish);
  const opponentFish = wholeNumber(record.opponentFish);
  if (bibNumber === null || bibNumber < 1 || bibNumber > MAX_FISH) return { ok: false, error: "Неверный номер" };
  if (period === null || period < 1 || period > QUALIFYING_PERIODS) return { ok: false, error: "Неверный период" };
  if (ownFish === null || ownFish < 0 || ownFish > MAX_FISH) return { ok: false, error: "Неверные свои поимки" };
  if (opponentFish === null || opponentFish < 0 || opponentFish > MAX_FISH) {
    return { ok: false, error: "Неверные поимки соперника" };
  }

  let opponentBib: number | null = null;
  if (record.opponentBib !== undefined && record.opponentBib !== null) {
    const parsed = wholeNumber(record.opponentBib);
    if (parsed === null || parsed < 1 || parsed > MAX_FISH) return { ok: false, error: "Неверный номер соперника" };
    if (parsed === bibNumber) return { ok: false, error: "Номер соперника совпадает с номером игрока" };
    opponentBib = parsed;
  }

  return {
    ok: true,
    period,
    side: {
      bibNumber,
      opponentBib,
      ownFish,
      opponentFish,
      reportedAt: new Date().toISOString(),
    },
  };
}

/** Обе стороны называют одни и те же две цифры: свои у одного — это чужие у другого. */
function judge(reports: Record<string, SideReport>, opponentBib: number | null): MatchStatus {
  const sides = Object.keys(reports)
    .map((key) => reports[key])
    .filter((side): side is SideReport => side !== undefined);
  if (opponentBib === null) return "CONFIRMED";
  if (sides.length < 2) return "PENDING";
  const left = sides[0];
  const right = sides[1];
  if (!left || !right) return "PENDING";
  if (left.ownFish === right.opponentFish && right.ownFish === left.opponentFish) return "CONFIRMED";
  return "CONFLICT";
}

export function attachMatchRoutes(app: MatchApp): void {
  app.post("/api/matches/report", (req, res) => {
    const parsed = readReport(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: parsed.error });
      return;
    }

    const key = duelKey(parsed.period, parsed.side.bibNumber, parsed.side.opponentBib);
    const current = inMemoryMatches[key] as MemoryMatch | undefined;
    const match: MemoryMatch = current ?? {
      id: key,
      period: parsed.period,
      opponentBib: parsed.side.opponentBib,
      reports: {},
      status: "PENDING",
      updatedAt: parsed.side.reportedAt,
    };
    if (match.opponentBib === null && parsed.side.opponentBib !== null) match.opponentBib = parsed.side.opponentBib;
    match.reports[String(parsed.side.bibNumber)] = parsed.side;
    match.status = judge(match.reports, match.opponentBib);
    match.updatedAt = parsed.side.reportedAt;
    inMemoryMatches[key] = match;

    res.status(201).json({ ok: true, matchId: key, status: match.status });
  });

  app.get("/api/matches/sync", (_req, res) => {
    const matches = Object.keys(inMemoryMatches).map((key) => {
      const match = inMemoryMatches[key] as MemoryMatch;
      const reports = Object.keys(match.reports)
        .map((bib) => match.reports[bib])
        .filter((side): side is SideReport => side !== undefined);
      return {
        id: match.id,
        period: match.period,
        status: match.status,
        reports,
        updatedAt: match.updatedAt,
      };
    });
    res.set("Cache-Control", "no-store");
    res.json({ matches });
  });
}
