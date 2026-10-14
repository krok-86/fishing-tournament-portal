"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inMemoryMatches = void 0;
exports.attachMatchRoutes = attachMatchRoutes;
/**
 * Точка обмена уловами периода. Данные живут в памяти процесса:
 * перезапуск сервера их стирает, постоянной базы здесь нет.
 * // trigger deploy fix
 */
exports.inMemoryMatches = {};
const MAX_FISH = 9999;
const QUALIFYING_PERIODS = 8;
function duelKey(period, bibNumber, opponentBib) {
    if (opponentBib === null)
        return `${period}:${bibNumber}`;
    const low = Math.min(bibNumber, opponentBib);
    const high = Math.max(bibNumber, opponentBib);
    return `${period}:${low}-${high}`;
}
function wholeNumber(value) {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}
function readReport(body) {
    if (!body || typeof body !== "object")
        return { ok: false, error: "Пустой отчёт" };
    const record = body;
    const bibNumber = wholeNumber(record.bibNumber);
    const period = wholeNumber(record.period);
    const ownFish = wholeNumber(record.ownFish);
    const opponentFish = wholeNumber(record.opponentFish);
    if (bibNumber === null || bibNumber < 1 || bibNumber > MAX_FISH)
        return { ok: false, error: "Неверный номер" };
    if (period === null || period < 1 || period > QUALIFYING_PERIODS)
        return { ok: false, error: "Неверный период" };
    if (ownFish === null || ownFish < 0 || ownFish > MAX_FISH)
        return { ok: false, error: "Неверные свои поимки" };
    if (opponentFish === null || opponentFish < 0 || opponentFish > MAX_FISH) {
        return { ok: false, error: "Неверные поимки соперника" };
    }
    let opponentBib = null;
    if (record.opponentBib !== undefined && record.opponentBib !== null) {
        const parsed = wholeNumber(record.opponentBib);
        if (parsed === null || parsed < 1 || parsed > MAX_FISH)
            return { ok: false, error: "Неверный номер соперника" };
        if (parsed === bibNumber)
            return { ok: false, error: "Номер соперника совпадает с номером игрока" };
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
function judge(reports, opponentBib) {
    const sides = Object.keys(reports)
        .map((key) => reports[key])
        .filter((side) => side !== undefined);
    if (opponentBib === null)
        return "CONFIRMED";
    if (sides.length < 2)
        return "PENDING";
    const left = sides[0];
    const right = sides[1];
    if (!left || !right)
        return "PENDING";
    if (left.ownFish === right.opponentFish && right.ownFish === left.opponentFish)
        return "CONFIRMED";
    return "CONFLICT";
}
function attachMatchRoutes(app) {
    app.post("/api/matches/report", (req, res) => {
        const parsed = readReport(req.body);
        if (!parsed.ok) {
            res.status(400).json({ ok: false, error: parsed.error });
            return;
        }
        const key = duelKey(parsed.period, parsed.side.bibNumber, parsed.side.opponentBib);
        const current = exports.inMemoryMatches[key];
        const match = current !== null && current !== void 0 ? current : {
            id: key,
            period: parsed.period,
            opponentBib: parsed.side.opponentBib,
            reports: {},
            status: "PENDING",
            updatedAt: parsed.side.reportedAt,
        };
        if (match.opponentBib === null && parsed.side.opponentBib !== null)
            match.opponentBib = parsed.side.opponentBib;
        match.reports[String(parsed.side.bibNumber)] = parsed.side;
        match.status = judge(match.reports, match.opponentBib);
        match.updatedAt = parsed.side.reportedAt;
        exports.inMemoryMatches[key] = match;
        res.status(201).json({ ok: true, matchId: key, status: match.status });
    });
    app.get("/api/matches/sync", (_req, res) => {
        const matches = Object.keys(exports.inMemoryMatches).map((key) => {
            const match = exports.inMemoryMatches[key];
            const reports = Object.keys(match.reports)
                .map((bib) => match.reports[bib])
                .filter((side) => side !== undefined);
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
