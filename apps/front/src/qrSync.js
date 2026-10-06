/**
 * Короткая строка поимок одного номера: FTP1|<номер>|<тур>.<период>=<рыбы>;...
 * Плей-офф вместо периода: FTP1|<номер>|QF|<пара>=<рыбы>
 * QF — четвертьфинал, пары 1–4. SF — полуфинал, пары 1–2. F — финал, пара 1.
 * Пример: FTP1|4|QF|1=3 — номер 4, первая четвертьфинальная пара, 3 рыбы.
 * В коде номер жеребьёвки, не slotId: на телефоне организатора слоты другие.
 */
const PREFIX = "FTP1";
const MAX_FISH = 9999;
const PLAYOFF_CELL = /^(QF|SF|F)\|([1-4])=(\d{1,4})$/;
const PAIR_LIMIT = { QF: 4, SF: 2, F: 1 };
const STAGE_ORDER = { QF: 0, SF: 1, F: 2 };
/** Сумма несинхронизированных дельт. Закрытый период без поимок уходит как ноль. */
export function snapshotFromEvents(records, slotId, live) {
    const anyCatch = new Set();
    const unsynced = new Map();
    const closed = new Set();
    for (const record of records) {
        const event = record.event;
        if (event.type === "CATCH_RECORDED" && event.payload.slotId === slotId) {
            const key = periodKey(event.payload.round, event.payload.period);
            anyCatch.add(key);
            if (!record.isSynced)
                unsynced.set(key, (unsynced.get(key) ?? 0) + event.payload.delta);
        }
        else if (!record.isSynced && event.type === "PERIOD_COMPLETED") {
            const covers = event.payload.protocols.some((protocol) => protocol.slotIdA === slotId || protocol.slotIdB === slotId);
            if (covers)
                closed.add(periodKey(event.payload.round, event.payload.period));
        }
    }
    const liveKey = live ? periodKey(live.round, live.period) : null;
    const keys = new Set([...unsynced.keys(), ...closed]);
    if (liveKey)
        keys.add(liveKey);
    const cells = [];
    for (const key of keys) {
        const parsed = parsePeriodKey(key);
        const fish = fishForPeriod(key, live, liveKey, unsynced, anyCatch);
        if (!parsed || fish === null)
            continue;
        cells.push({ round: parsed.round, period: parsed.period, fish: nonNegative(fish) });
    }
    cells.sort((left, right) => left.round - right.round || left.period - right.period);
    return cells;
}
export function encodeCatchSnapshot(bibNumber, cells) {
    const body = cells.map((cell) => `${cell.round}.${cell.period}=${cell.fish}`).join(";");
    return `${PREFIX}|${bibNumber}|${body}`;
}
/** FTP1|4|QF|1=3 или несколько стадий: FTP1|4|QF|1=3;SF|1=2 */
export function encodePlayoffSnapshot(bibNumber, cells) {
    const body = [...cells]
        .sort(comparePlayoffCells)
        .map((cell) => `${cell.stage}|${cell.pair}=${cell.fish}`)
        .join(";");
    return `${PREFIX}|${bibNumber}|${body}`;
}
export function playoffMatchId(stage, pair) {
    if (stage === "F")
        return "final";
    if (stage === "SF")
        return `sf-${pair - 1}`;
    return `qf-${pair - 1}`;
}
export function playoffStageCode(stage) {
    if (stage === "quarterfinal")
        return "QF";
    if (stage === "semifinal")
        return "SF";
    return "F";
}
export function decodeCatchSnapshot(raw) {
    const text = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
    const parts = text.split("|");
    if (parts.length < 3 || parts[0] !== PREFIX) {
        return { ok: false, error: "Это не код результатов турнира" };
    }
    const bibNumber = Number(parts[1]);
    if (!Number.isInteger(bibNumber) || bibNumber < 1 || bibNumber > MAX_FISH) {
        return { ok: false, error: "В коде неверный номер игрока" };
    }
    const rest = parts.slice(2).join("|");
    if (isPlayoffBody(rest))
        return decodePlayoffBody(bibNumber, rest);
    if (parts.length !== 3)
        return { ok: false, error: "Строка QR повреждена" };
    return decodeQualifyingBody(bibNumber, parts[2] ?? "");
}
export function expandCatchEvents(tournamentId, slotId, cells, timestamp) {
    const events = [];
    for (const cell of cells) {
        for (let index = 0; index < cell.fish; index += 1) {
            events.push({
                id: crypto.randomUUID(),
                tournamentId,
                type: "CATCH_RECORDED",
                timestamp: timestamp + events.length,
                payload: {
                    slotId,
                    round: cell.round,
                    period: cell.period,
                    delta: 1,
                },
            });
        }
    }
    return events;
}
export function totalFish(cells) {
    return cells.reduce((sum, cell) => sum + cell.fish, 0);
}
function decodeQualifyingBody(bibNumber, body) {
    const chunks = body.split(";").filter((chunk) => chunk.length > 0);
    if (chunks.length === 0)
        return { ok: false, error: "В коде нет поимок" };
    const seen = new Set();
    const cells = [];
    for (const chunk of chunks) {
        const match = /^([12])\.([1-9]|10)=(\d{1,4})$/.exec(chunk);
        if (!match)
            return { ok: false, error: "Строка QR повреждена" };
        const round = Number(match[1]);
        const period = Number(match[2]);
        const fish = Number(match[3]);
        if (!isRound(round) || !isPeriod(period) || fish > MAX_FISH) {
            return { ok: false, error: "В коде неверный период" };
        }
        const key = periodKey(round, period);
        if (seen.has(key))
            return { ok: false, error: "В коде повторяется период" };
        seen.add(key);
        cells.push({ round, period, fish });
    }
    cells.sort((left, right) => left.round - right.round || left.period - right.period);
    return { ok: true, mode: "qualifying", bibNumber, cells };
}
function decodePlayoffBody(bibNumber, body) {
    const chunks = body.split(";").filter((chunk) => chunk.length > 0);
    if (chunks.length === 0)
        return { ok: false, error: "В коде нет поимок" };
    const seen = new Set();
    const cells = [];
    for (const chunk of chunks) {
        const match = PLAYOFF_CELL.exec(chunk);
        if (!match)
            return { ok: false, error: "Строка QR повреждена" };
        const stage = match[1];
        const pair = Number(match[2]);
        const fish = Number(match[3]);
        if (!isPlayoffStage(stage) || pair > PAIR_LIMIT[stage] || fish > MAX_FISH) {
            return { ok: false, error: "В коде неверная пара" };
        }
        const key = `${stage}|${pair}`;
        if (seen.has(key))
            return { ok: false, error: "В коде повторяется матч" };
        seen.add(key);
        cells.push({ stage, pair, fish });
    }
    cells.sort(comparePlayoffCells);
    return { ok: true, mode: "playoff", bibNumber, cells };
}
function isPlayoffBody(body) {
    const head = body.split(";")[0] ?? "";
    return /^(QF|SF|F)\|/.test(head);
}
function isPlayoffStage(value) {
    return value === "QF" || value === "SF" || value === "F";
}
function comparePlayoffCells(left, right) {
    return STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage] || left.pair - right.pair;
}
function fishForPeriod(key, live, liveKey, unsynced, anyCatch) {
    if (live && key === liveKey)
        return live.fish;
    if (unsynced.has(key))
        return unsynced.get(key) ?? 0;
    if (anyCatch.has(key))
        return null;
    return 0;
}
function periodKey(round, period) {
    return `${round}.${period}`;
}
function parsePeriodKey(key) {
    const [roundText, periodText] = key.split(".");
    const round = Number(roundText);
    const period = Number(periodText);
    if (!isRound(round) || !isPeriod(period))
        return null;
    return { round, period };
}
function nonNegative(fish) {
    if (!Number.isFinite(fish))
        return 0;
    return Math.max(0, Math.min(MAX_FISH, Math.trunc(fish)));
}
function isRound(value) {
    return value === 1 || value === 2;
}
function isPeriod(value) {
    return Number.isInteger(value) && value >= 1 && value <= 10;
}
