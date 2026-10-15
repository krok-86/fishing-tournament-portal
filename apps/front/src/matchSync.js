/** Атомарная отправка улова периода. Очередь и повтор живут на телефоне, не здесь. */
const REPORT_TIMEOUT_MS = 8000;
export async function postMatchReport(report) {
    if (typeof navigator !== "undefined" && !navigator.onLine)
        return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
    try {
        const response = await fetch("/api/matches/report", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(report),
            signal: controller.signal,
        });
        return response.ok;
    }
    catch {
        return false;
    }
    finally {
        window.clearTimeout(timer);
    }
}
export async function fetchMatchSync() {
    if (typeof navigator !== "undefined" && !navigator.onLine)
        return { ok: false };
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
    try {
        const response = await fetch("/api/matches/sync", {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
        });
        if (!response.ok)
            return { ok: false };
        const body = await response.json().catch(() => null);
        const matches = parseSyncMatches(body);
        if (!matches)
            return { ok: false };
        return { ok: true, matches };
    }
    catch {
        return { ok: false };
    }
    finally {
        window.clearTimeout(timer);
    }
}
function parseSyncMatches(body) {
    if (!isRecord(body) || !Array.isArray(body.matches))
        return null;
    const matches = [];
    for (const item of body.matches) {
        const parsed = parseMatch(item);
        if (parsed)
            matches.push(parsed);
    }
    return matches;
}
function parseMatch(value) {
    if (!isRecord(value))
        return null;
    if (value.status !== "PENDING" && value.status !== "CONFIRMED" && value.status !== "CONFLICT")
        return null;
    if (typeof value.period !== "number" || !Number.isInteger(value.period))
        return null;
    if (!Array.isArray(value.reports))
        return null;
    const reports = [];
    for (const item of value.reports) {
        const report = parseReport(item);
        if (!report)
            return null;
        reports.push(report);
    }
    const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `${value.period}`;
    return { id, period: value.period, status: value.status, reports };
}
function parseReport(value) {
    if (!isRecord(value))
        return null;
    const bibNumber = whole(value.bibNumber);
    const ownFish = whole(value.ownFish);
    const opponentFish = whole(value.opponentFish);
    if (bibNumber === null || ownFish === null || opponentFish === null)
        return null;
    let opponentBib = null;
    if (value.opponentBib !== undefined && value.opponentBib !== null) {
        const parsed = whole(value.opponentBib);
        if (parsed === null)
            return null;
        opponentBib = parsed;
    }
    return { bibNumber, opponentBib, ownFish, opponentFish };
}
function whole(value) {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
