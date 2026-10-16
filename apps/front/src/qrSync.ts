import type {
  GridSlot,
  GroupId,
  PeriodIndex,
  PeriodPhase,
  PlayoffStage,
  RoundIndex,
  TournamentEvent,
} from "../../../packages/shared/src/types.ts";
import { QUALIFYING_PERIOD_COUNT } from "../../../packages/shared/src/types.ts";

/**
 * Короткая строка поимок одного номера: FTP1|<номер>|<тур>.<период>=<рыбы>;...|N<ФИО>
 * Плей-офф вместо периода: FTP1|<номер>|QF|<пара>=<рыбы>|N<ФИО>
 * QF — четвертьфинал, пары 1–4. SF — полуфинал, пары 1–2. F — финал, пара 1. TF — матч за 3-е место, пара 1.
 * Пример: FTP1|4|QF|1=3 — номер 4, первая четвертьфинальная пара, 3 рыбы.
 * Хвост S1F — период и сирена с телефона, который сдал код. На очки не влияет.
 * В коде номер жеребьёвки, не slotId: на телефоне организатора слоты другие.
 *
 * Стартовый код орга: FTPS1.<сжатая сетка Бергера и стартовый лист>
 * Сигнал периода: FTPP1|<период>|<W|F|C>
 * Стартовый код кубка: FTPC1.<сжатый топ-8 и пары 1/4>. Номер жеребьёвки, не slotId.
 */
const PREFIX = "FTP1";
const MAX_FISH = 9999;
const PLAYOFF_CELL = /^(QF|SF|F|TF)\|([1-4])=(\d{1,4})$/;
const PAIR_LIMIT = { QF: 4, SF: 2, F: 1, TF: 1 } as const;
const STAGE_ORDER = { QF: 0, SF: 1, F: 2, TF: 3 } as const;

export interface QrCatchCell {
  round: RoundIndex;
  period: PeriodIndex;
  fish: number;
}

export interface LiveCatch {
  round: RoundIndex;
  period: PeriodIndex;
  fish: number;
}

export type PlayoffStageCode = "QF" | "SF" | "F" | "TF";

export interface QrPlayoffCell {
  stage: PlayoffStageCode;
  /** Номер пары с 1: четвертьфинал 1–4, полуфинал 1–2, финал и матч за 3-е место — 1. */
  pair: number;
  fish: number;
}

interface SyncRecord {
  isSynced: boolean;
  event: TournamentEvent;
}

export interface PlayerQrPacket {
  payload: string;
  bibNumber: number;
  displayName: string;
  fish: number;
  periods: number;
  cells: readonly QrCatchCell[];
  playoffCells: readonly QrPlayoffCell[];
  /** Период, вложенный в строку в момент сдачи. */
  markLabel?: string;
}

export type PlayerQrExportResult = { ok: true; packet: PlayerQrPacket } | { ok: false; error: string };

export interface PlayerQrImport {
  bibNumber: number;
  displayName: string;
  fish: number;
  periods: number;
  /** Текст для вкладки организатора, когда строка была кубковой. */
  cup?: string;
  /** Период, который телефон игрока вложил в код при сдаче. Сирену орга не перебивает. */
  mark?: string;
  /** Сколько периодов QR не совпали с уже записанным счётом. */
  disputes?: number;
}

export type PlayerQrImportResult = { ok: true; packet: PlayerQrImport } | { ok: false; error: string };

export interface PeriodMark {
  period: PeriodIndex;
  phase: PeriodPhase;
}

export type DecodedCatchSnapshot =
  | {
      ok: true;
      mode: "qualifying";
      bibNumber: number;
      cells: readonly QrCatchCell[];
      mark: PeriodMark | null;
      displayName: string | null;
    }
  | {
      ok: true;
      mode: "playoff";
      bibNumber: number;
      cells: readonly QrPlayoffCell[];
      mark: PeriodMark | null;
      displayName: string | null;
    }
  | { ok: false; error: string };

/** Сумма несинхронизированных дельт. Закрытый период без поимок уходит как ноль. */
export function snapshotFromEvents(
  records: readonly SyncRecord[],
  slotId: string,
  live: LiveCatch | null,
): QrCatchCell[] {
  const anyCatch = new Set<string>();
  const unsynced = new Map<string, number>();
  const closed = new Set<string>();

  for (const record of records) {
    const event = record.event;
    if (event.type === "CATCH_RECORDED" && event.payload.slotId === slotId) {
      const key = periodKey(event.payload.round, event.payload.period);
      anyCatch.add(key);
      if (!record.isSynced) unsynced.set(key, (unsynced.get(key) ?? 0) + event.payload.delta);
    } else if (!record.isSynced && event.type === "PERIOD_COMPLETED") {
      const covers = event.payload.protocols.some(
        (protocol) => protocol.slotIdA === slotId || protocol.slotIdB === slotId,
      );
      if (covers) closed.add(periodKey(event.payload.round, event.payload.period));
    }
  }

  const liveKey = live ? periodKey(live.round, live.period) : null;
  const keys = new Set<string>([...unsynced.keys(), ...closed]);
  if (liveKey) keys.add(liveKey);

  const cells: QrCatchCell[] = [];
  for (const key of keys) {
    const parsed = parsePeriodKey(key);
    const fish = fishForPeriod(key, live, liveKey, unsynced, anyCatch);
    if (!parsed || fish === null) continue;
    cells.push({ round: parsed.round, period: parsed.period, fish: nonNegative(fish) });
  }

  cells.sort((left, right) => left.round - right.round || left.period - right.period);
  return cells;
}

export function encodeCatchSnapshot(
  bibNumber: number,
  cells: readonly QrCatchCell[],
  mark?: PeriodMark | null,
  displayName?: string | null,
): string {
  const body = cells.map((cell) => `${cell.round}.${cell.period}=${cell.fish}`).join(";");
  return withPeriodMark(withAthleteName(`${PREFIX}|${bibNumber}|${body}`, displayName), mark);
}

/** FTP1|4|QF|1=3 или несколько стадий: FTP1|4|QF|1=3;SF|1=2 */
export function encodePlayoffSnapshot(
  bibNumber: number,
  cells: readonly QrPlayoffCell[],
  mark?: PeriodMark | null,
  displayName?: string | null,
): string {
  const body = [...cells]
    .sort(comparePlayoffCells)
    .map((cell) => `${cell.stage}|${cell.pair}=${cell.fish}`)
    .join(";");
  return withPeriodMark(withAthleteName(`${PREFIX}|${bibNumber}|${body}`, displayName), mark);
}

export function playoffMatchId(stage: PlayoffStageCode, pair: number): string {
  if (stage === "F") return "final";
  if (stage === "TF") return "third";
  if (stage === "SF") return `sf-${pair - 1}`;
  return `qf-${pair - 1}`;
}

export function playoffStageCode(stage: PlayoffStage): PlayoffStageCode {
  if (stage === "quarterfinal") return "QF";
  if (stage === "semifinal") return "SF";
  if (stage === "third") return "TF";
  return "F";
}

export function decodeCatchSnapshot(raw: string): DecodedCatchSnapshot {
  const text = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  const marked = splitPeriodMark(text);
  const named = splitNameToken(marked.body);
  if (!named.ok) return named;
  const parts = named.body.split("|");
  if (parts.length < 3 || parts[0] !== PREFIX) {
    return { ok: false, error: "Это не код результатов турнира" };
  }

  const bibNumber = Number(parts[1]);
  if (!Number.isInteger(bibNumber) || bibNumber < 1 || bibNumber > MAX_FISH) {
    return { ok: false, error: "В коде неверный номер игрока" };
  }

  const rest = parts.slice(2).join("|");
  const decoded = isPlayoffBody(rest)
    ? decodePlayoffBody(bibNumber, rest)
    : parts.length === 3
      ? decodeQualifyingBody(bibNumber, parts[2] ?? "")
      : { ok: false as const, error: "Строка QR повреждена" };
  if (!decoded.ok) return decoded;
  return { ...decoded, mark: marked.mark, displayName: named.displayName };
}

export function expandCatchEvents(
  tournamentId: string,
  slotId: string,
  cells: readonly QrCatchCell[],
  timestamp: number,
): TournamentEvent[] {
  const events: TournamentEvent[] = [];
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

export function totalFish(cells: readonly { fish: number }[]): number {
  return cells.reduce((sum, cell) => sum + cell.fish, 0);
}

function decodeQualifyingBody(bibNumber: number, body: string): DecodedCatchSnapshot {
  const chunks = body.split(";").filter((chunk) => chunk.length > 0);
  if (chunks.length === 0) return { ok: false, error: "В коде нет поимок" };

  const seen = new Set<string>();
  const cells: QrCatchCell[] = [];
  for (const chunk of chunks) {
    const match = /^([12])\.([1-9]|10)=(\d{1,4})$/.exec(chunk);
    if (!match) return { ok: false, error: "Строка QR повреждена" };
    const round = Number(match[1]);
    const period = Number(match[2]);
    const fish = Number(match[3]);
    if (!isRound(round) || !isPeriod(period) || fish > MAX_FISH) {
      return { ok: false, error: "В коде неверный период" };
    }
    const key = periodKey(round, period);
    if (seen.has(key)) return { ok: false, error: "В коде повторяется период" };
    seen.add(key);
    cells.push({ round, period, fish });
  }

  cells.sort((left, right) => left.round - right.round || left.period - right.period);
  return { ok: true, mode: "qualifying", bibNumber, cells, mark: null, displayName: null };
}

function decodePlayoffBody(bibNumber: number, body: string): DecodedCatchSnapshot {
  const chunks = body.split(";").filter((chunk) => chunk.length > 0);
  if (chunks.length === 0) return { ok: false, error: "В коде нет поимок" };

  const seen = new Set<string>();
  const cells: QrPlayoffCell[] = [];
  for (const chunk of chunks) {
    const match = PLAYOFF_CELL.exec(chunk);
    if (!match) return { ok: false, error: "Строка QR повреждена" };
    const stage = match[1];
    const pair = Number(match[2]);
    const fish = Number(match[3]);
    if (!isPlayoffStage(stage) || pair > PAIR_LIMIT[stage] || fish > MAX_FISH) {
      return { ok: false, error: "В коде неверная пара" };
    }
    const key = `${stage}|${pair}`;
    if (seen.has(key)) return { ok: false, error: "В коде повторяется матч" };
    seen.add(key);
    cells.push({ stage, pair, fish });
  }

  cells.sort(comparePlayoffCells);
  return { ok: true, mode: "playoff", bibNumber, cells, mark: null, displayName: null };
}

function isPlayoffBody(body: string): boolean {
  const head = body.split(";")[0] ?? "";
  return /^(QF|SF|F|TF)\|/.test(head);
}

function isPlayoffStage(value: string): value is PlayoffStageCode {
  return value === "QF" || value === "SF" || value === "F" || value === "TF";
}

function comparePlayoffCells(left: QrPlayoffCell, right: QrPlayoffCell): number {
  return STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage] || left.pair - right.pair;
}

function fishForPeriod(
  key: string,
  live: LiveCatch | null,
  liveKey: string | null,
  unsynced: ReadonlyMap<string, number>,
  anyCatch: ReadonlySet<string>,
): number | null {
  if (live && key === liveKey) return live.fish;
  if (unsynced.has(key)) return unsynced.get(key) ?? 0;
  if (anyCatch.has(key)) return null;
  return 0;
}

function withAthleteName(payload: string, displayName?: string | null): string {
  const name = displayName?.trim().replace(/\s+/g, " ") ?? "";
  if (!name) return payload;
  return `${payload}|N${encodeURIComponent(name)}`;
}

function splitNameToken(
  body: string,
): { ok: true; body: string; displayName: string | null } | { ok: false; error: string } {
  const cut = body.lastIndexOf("|");
  if (cut < 0) return { ok: true, body, displayName: null };
  const token = body.slice(cut + 1);
  if (!token.startsWith("N")) return { ok: true, body, displayName: null };
  try {
    const displayName = decodeURIComponent(token.slice(1)).trim().replace(/\s+/g, " ");
    if (!displayName) return { ok: false, error: "В коде пустое ФИО" };
    return { ok: true, body: body.slice(0, cut), displayName };
  } catch {
    return { ok: false, error: "В коде повреждено ФИО" };
  }
}

function withPeriodMark(payload: string, mark?: PeriodMark | null): string {
  if (!mark) return payload;
  return `${payload}|S${mark.period}${phaseLetter(mark.phase)}`;
}

function splitPeriodMark(text: string): { body: string; mark: PeriodMark | null } {
  const cut = text.lastIndexOf("|");
  if (cut < 0) return { body: text, mark: null };
  const token = text.slice(cut + 1);
  const mark = parsePeriodToken(token);
  if (!mark) return { body: text, mark: null };
  return { body: text.slice(0, cut), mark };
}

function parsePeriodToken(token: string): PeriodMark | null {
  const match = /^S([1-8])([WFC])$/.exec(token);
  if (!match) return null;
  const period = Number(match[1]);
  const phase = letterPhase(match[2] ?? "");
  if (!isQualifyingPeriod(period) || !phase) return null;
  return { period, phase };
}

const PHASE_LETTER: Record<PeriodPhase, "W" | "F" | "C"> = {
  waiting: "W",
  fishing: "F",
  closed: "C",
};

function phaseLetter(phase: PeriodPhase): "W" | "F" | "C" {
  return PHASE_LETTER[phase];
}

function letterPhase(letter: string): PeriodPhase | null {
  if (letter === "W") return "waiting";
  if (letter === "F") return "fishing";
  if (letter === "C") return "closed";
  return null;
}

function isQualifyingPeriod(period: number): period is PeriodIndex {
  return Number.isInteger(period) && period >= 1 && period <= QUALIFYING_PERIOD_COUNT;
}

export function periodStatusLabel(period: number, phase: PeriodPhase): string {
  if (phase === "fishing") return `ПЕРИОД ${period} (ИДЕТ ЛОВЛЯ)`;
  if (phase === "closed") return `ПЕРИОД ${period} ЗАВЕРШЕН. ОЖИДАЙТЕ СИГНАЛА`;
  return `ОЖИДАНИЕ СТАРТА ПЕРИОДА ${period}`;
}

/** Короткий код сирены. Игрок сканирует его, когда сдаёт результат или слышит сигнал. */
export function encodePeriodSignal(period: PeriodIndex, phase: PeriodPhase): string {
  return `FTPP1|${period}|${phaseLetter(phase)}`;
}

export function decodePeriodSignal(raw: string): { ok: true; mark: PeriodMark } | { ok: false; error: string } {
  const text = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  const match = /^FTPP1\|([1-8])\|([WFC])$/.exec(text);
  if (!match) return { ok: false, error: "Это не сигнал периода" };
  const period = Number(match[1]);
  const phase = letterPhase(match[2] ?? "");
  if (!isQualifyingPeriod(period) || !phase) return { ok: false, error: "В сигнале неверный период" };
  return { ok: true, mark: { period, phase } };
}

export interface StartParticipant {
  bibNumber: number;
  displayName: string;
  groupId: GroupId;
  ghost: boolean;
}

export interface StartSeat {
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string;
  /** 0 — левый борт пустой, одиночка сидит справа. */
  leftBib: number;
  /** null — правый борт пустой. */
  rightBib: number | null;
}

export interface StartSnapshot {
  periodsPerRound: number;
  sectorCount: number;
  period: PeriodIndex;
  phase: PeriodPhase;
  tournamentName: string;
  /** ISO `YYYY-MM-DD`. */
  tournamentDate: string;
  participants: readonly StartParticipant[];
  seats: readonly StartSeat[];
}

export function isTournamentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type StartDecodeResult = { ok: true; snapshot: StartSnapshot } | { ok: false; error: string };

const START_PREFIX = "FTPS1.";

export function seatsFromGrid(grid: readonly GridSlot[], bibBySlot: ReadonlyMap<string, number>): StartSeat[] {
  const grouped = new Map<string, StartSeat>();
  for (const slot of grid) {
    const bib = bibBySlot.get(slot.slotId);
    if (!bib) continue;
    const key = `${slot.round}.${slot.period}.${slot.sectorId}`;
    const seat = grouped.get(key) ?? {
      round: slot.round,
      period: slot.period,
      sectorId: slot.sectorId,
      leftBib: 0,
      rightBib: null,
    };
    if (slot.side === "right") seat.rightBib = bib;
    else seat.leftBib = bib;
    grouped.set(key, seat);
  }
  return [...grouped.values()]
    .filter((seat) => seat.leftBib > 0 || (seat.rightBib !== null && seat.rightBib > 0))
    .sort(
      (left, right) =>
        left.round - right.round ||
        left.period - right.period ||
        Number(left.sectorId) - Number(right.sectorId) ||
        left.sectorId.localeCompare(right.sectorId),
    );
}

export function serializeStartSnapshot(snapshot: StartSnapshot): string {
  const header = `1|${snapshot.periodsPerRound}|${snapshot.sectorCount}|${snapshot.period}|${phaseLetter(snapshot.phase)}`;
  const meta = `M\t${escapeField(snapshot.tournamentName.trim())}\t${snapshot.tournamentDate}`;
  const people = [...snapshot.participants]
    .sort((left, right) => left.bibNumber - right.bibNumber)
    .map((participant) => rosterPair(participant));
  const lines = new Map<string, string[]>();
  const seats = [...snapshot.seats].sort(
    (left, right) =>
      left.round - right.round ||
      left.period - right.period ||
      Number(left.sectorId) - Number(right.sectorId),
  );
  for (const seat of seats) {
    const key = `${seat.round}.${seat.period}`;
    const list = lines.get(key) ?? [];
    const left = seat.leftBib > 0 ? String(seat.leftBib) : "";
    const right = seat.rightBib === null ? "" : String(seat.rightBib);
    list.push(`${seat.sectorId}=${left}/${right}`);
    lines.set(key, list);
  }
  const grid = [...lines.entries()].map(([key, list]) => `${key}:${list.join(",")}`);
  return [header, meta, ...people, "#", ...grid].join("\n");
}

export async function encodeStartSnapshot(snapshot: StartSnapshot): Promise<string> {
  const plain = serializeStartSnapshot(snapshot);
  if (typeof CompressionStream === "undefined") return `FTPS1|${plain}`;
  const packed = await deflateBase64Url(plain);
  return `${START_PREFIX}${packed}`;
}

export async function decodeStartSnapshot(raw: string): Promise<StartDecodeResult> {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (text.replace(/\s+/g, "").startsWith(START_PREFIX)) {
    try {
      const packed = text.replace(/\s+/g, "").slice(START_PREFIX.length);
      return parseStartSnapshot(await inflateBase64Url(packed));
    } catch {
      return { ok: false, error: "Стартовый код не раскрылся. Покажите QR ещё раз." };
    }
  }
  if (text.startsWith("FTPS1|")) return parseStartSnapshot(text.slice("FTPS1|".length));
  return { ok: false, error: "Это не стартовый код турнира" };
}

export function parseStartSnapshot(plain: string): StartDecodeResult {
  const lines = plain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
  const header = /^1\|(\d+)\|(\d+)\|([1-8])\|([WFC])$/.exec(lines[0] ?? "");
  const splitAt = lines.indexOf("#");
  if (!header || splitAt < 2) return { ok: false, error: "Стартовый код повреждён" };

  const periodsPerRound = Number(header[1]);
  const sectorCount = Number(header[2]);
  const period = Number(header[3]);
  const phase = letterPhase(header[4] ?? "");
  if (periodsPerRound !== QUALIFYING_PERIOD_COUNT || !Number.isInteger(sectorCount) || sectorCount < 1) {
    return { ok: false, error: "В стартовом коде неверная сетка" };
  }
  if (!isQualifyingPeriod(period) || !phase) return { ok: false, error: "В стартовом коде неверный период" };

  let tournamentName = "Локальный турнир";
  let tournamentDate = "";
  let sawMeta = false;
  const participants: StartParticipant[] = [];
  const seenBibs = new Set<number>();
  for (const line of lines.slice(1, splitAt)) {
    if (line.startsWith("M\t")) {
      if (sawMeta) return { ok: false, error: "В стартовом коде повторяется название" };
      sawMeta = true;
      const [, nameText, dateText] = line.split("\t");
      const name = unescapeField(nameText ?? "").trim().replace(/\s+/g, " ");
      const date = (dateText ?? "").trim();
      if (!name || !isTournamentDate(date)) {
        return { ok: false, error: "В стартовом коде нет названия или даты" };
      }
      tournamentName = name;
      tournamentDate = date;
      continue;
    }
    const roster = readRosterPair(line);
    if (!roster) return { ok: false, error: "В стартовом коде повреждён участник" };
    const { bibText, nameText, groupText, ghostText } = roster;
    const bibNumber = Number(bibText);
    const displayName = unescapeField(nameText ?? "").trim();
    if (!Number.isInteger(bibNumber) || bibNumber < 1 || bibNumber > MAX_FISH || displayName.length === 0) {
      return { ok: false, error: "В стартовом коде повреждён участник" };
    }
    if (seenBibs.has(bibNumber)) return { ok: false, error: "В стартовом коде повторяется номер" };
    if (groupText !== "A" && groupText !== "B") return { ok: false, error: "В стартовом коде неверная группа" };
    if (ghostText !== "0" && ghostText !== "1") return { ok: false, error: "В стартовом коде повреждён участник" };
    seenBibs.add(bibNumber);
    participants.push({
      bibNumber,
      displayName,
      groupId: groupText,
      ghost: ghostText === "1",
    });
  }
  if (participants.length < 2) return { ok: false, error: "В стартовом коде мало участников" };

  const seats: StartSeat[] = [];
  const seenPeriods = new Set<string>();
  for (const line of lines.slice(splitAt + 1)) {
    const match = /^([12])\.([1-8]):(.+)$/.exec(line);
    if (!match) return { ok: false, error: "В стартовом коде повреждена сетка" };
    const round = Number(match[1]);
    const seatPeriod = Number(match[2]);
    if (!isRound(round) || !isQualifyingPeriod(seatPeriod)) return { ok: false, error: "В стартовом коде повреждена сетка" };
    const periodKey = `${round}.${seatPeriod}`;
    if (seenPeriods.has(periodKey)) return { ok: false, error: "В стартовом коде повторяется период сетки" };
    seenPeriods.add(periodKey);
    const seenHere = new Set<number>();
    const seenSectors = new Set<string>();
    for (const chunk of (match[3] ?? "").split(",")) {
      const seatMatch = /^(\d+)=(\d*)\/(\d*)$/.exec(chunk);
      if (!seatMatch) return { ok: false, error: "В стартовом коде повреждена пара" };
      const sectorId = seatMatch[1] ?? "";
      const leftText = seatMatch[2] ?? "";
      const rightText = seatMatch[3] ?? "";
      const leftBib = leftText.length === 0 ? 0 : Number(leftText);
      const rightBib = rightText.length === 0 ? null : Number(rightText);
      if (leftBib === 0 && rightBib === null) return { ok: false, error: "В стартовом коде пустой сектор" };
      if ((leftBib !== 0 && !seenBibs.has(leftBib)) || (rightBib !== null && !seenBibs.has(rightBib))) {
        return { ok: false, error: "В сетке есть номер, которого нет в стартовом листе" };
      }
      if (
        (leftBib !== 0 && rightBib === leftBib) ||
        (leftBib !== 0 && seenHere.has(leftBib)) ||
        (rightBib !== null && seenHere.has(rightBib))
      ) {
        return { ok: false, error: "В одном периоде номер стоит дважды" };
      }
      if (seenSectors.has(sectorId)) return { ok: false, error: "В одном периоде повторяется сектор" };
      if (leftBib !== 0) seenHere.add(leftBib);
      if (rightBib !== null) seenHere.add(rightBib);
      seenSectors.add(sectorId);
      seats.push({ round, period: seatPeriod, sectorId, leftBib, rightBib });
    }
  }
  if (seats.length === 0) return { ok: false, error: "В стартовом коде нет сетки" };

  return {
    ok: true,
    snapshot: {
      periodsPerRound,
      sectorCount,
      period,
      phase,
      tournamentName,
      tournamentDate,
      participants,
      seats,
    },
  };
}

/** `номер:ФИО`, затем группа и признак фантома. Номер жеребьёвки короче UUID и не раздувает QR. */
function rosterPair(participant: StartParticipant): string {
  const name = escapeField(participant.displayName.trim().replace(/\s+/g, " "));
  return `${participant.bibNumber}:${name}\t${participant.groupId}\t${participant.ghost ? 1 : 0}`;
}

function readRosterPair(
  line: string,
): { bibText: string; nameText: string; groupText: string; ghostText: string } | null {
  const fields = line.split("\t");
  const head = fields[0] ?? "";
  const colon = head.indexOf(":");
  if (colon > 0 && fields.length >= 3) {
    return {
      bibText: head.slice(0, colon),
      nameText: head.slice(colon + 1),
      groupText: fields[1] ?? "",
      ghostText: fields[2] ?? "",
    };
  }
  if (fields.length >= 4 && /^\d+$/.test(head)) {
    return {
      bibText: head,
      nameText: fields[1] ?? "",
      groupText: fields[2] ?? "",
      ghostText: fields[3] ?? "",
    };
  }
  return null;
}

function escapeField(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "").replaceAll("\t", "\\t");
}

function unescapeField(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char ?? "";
      continue;
    }
    const next = value[index + 1];
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "\\") out += "\\";
    else out += char;
    if (next === "n" || next === "t" || next === "\\") index += 1;
  }
  return out;
}

async function deflateBase64Url(text: string): Promise<string> {
  const stream = blobBytes(new TextEncoder().encode(text)).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64Url(compressed);
}

async function inflateBase64Url(packed: string): Promise<string> {
  const stream = blobBytes(base64UrlToBytes(packed)).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function blobBytes(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Пары 1/4: 1–8, 2–7, 3–6, 4–5. Совпадает с сеткой, которую пишет «Сформировать Плей-офф». */
const CUP_PAIR_SEEDS: readonly (readonly [number, number])[] = [
  [1, 8],
  [2, 7],
  [3, 6],
  [4, 5],
];

export interface PlayoffGridPlayer {
  bibNumber: number;
  displayName: string;
  place: number;
  seed: number;
}

export interface PlayoffGridPair {
  /** Номер четвертьфинала с 1. */
  pair: number;
  bibA: number;
  bibB: number;
}

export interface PlayoffGridSnapshot {
  players: readonly PlayoffGridPlayer[];
  pairs: readonly PlayoffGridPair[];
}

export type PlayoffGridDecodeResult = { ok: true; snapshot: PlayoffGridSnapshot } | { ok: false; error: string };

const CUP_PREFIX = "FTPC1.";

export function playoffGridFromSeeds(
  participants: readonly { slotId: string; bibNumber: number; displayName: string }[],
  seeds: readonly { slotId: string; place: number; seed: number }[],
  quarterfinals: readonly { order: number; slotIdA: string | null; slotIdB: string | null }[],
): PlayoffGridSnapshot | null {
  if (seeds.length !== 8 || quarterfinals.length !== 4) return null;
  const bySlot = new Map(participants.map((person) => [person.slotId, person]));
  const players: PlayoffGridPlayer[] = [];
  for (const seed of seeds) {
    const person = bySlot.get(seed.slotId);
    const name = person?.displayName.trim().replace(/\s+/g, " ") ?? "";
    if (!person || !isBib(person.bibNumber) || !isCupPlace(seed.place) || !isCupSeed(seed.seed) || name.length === 0) {
      return null;
    }
    players.push({ bibNumber: person.bibNumber, displayName: name, place: seed.place, seed: seed.seed });
  }
  if (new Set(players.map((player) => player.bibNumber)).size !== 8) return null;
  if (new Set(players.map((player) => player.seed)).size !== 8) return null;

  const bySeed = new Map(players.map((player) => [player.seed, player]));
  const pairs: PlayoffGridPair[] = [];
  for (let index = 0; index < CUP_PAIR_SEEDS.length; index += 1) {
    const match = quarterfinals.find((item) => item.order === index);
    const [seedA, seedB] = CUP_PAIR_SEEDS[index] ?? [0, 0];
    const left = bySeed.get(seedA);
    const right = bySeed.get(seedB);
    const slotA = match?.slotIdA ? bySlot.get(match.slotIdA) : undefined;
    const slotB = match?.slotIdB ? bySlot.get(match.slotIdB) : undefined;
    if (!left || !right || !slotA || !slotB) return null;
    if (slotA.bibNumber !== left.bibNumber || slotB.bibNumber !== right.bibNumber) return null;
    pairs.push({ pair: index + 1, bibA: left.bibNumber, bibB: right.bibNumber });
  }
  return { players, pairs };
}

export function serializePlayoffGrid(snapshot: PlayoffGridSnapshot): string {
  const people = [...snapshot.players]
    .sort((left, right) => left.seed - right.seed)
    .map(
      (player) =>
        `${player.bibNumber}\t${escapeField(player.displayName)}\t${player.place}\t${player.seed}`,
    );
  const pairs = [...snapshot.pairs]
    .sort((left, right) => left.pair - right.pair)
    .map((pair) => `${pair.pair}=${pair.bibA}/${pair.bibB}`);
  return ["1", ...people, "#", ...pairs].join("\n");
}

export async function encodePlayoffGrid(snapshot: PlayoffGridSnapshot): Promise<string> {
  const plain = serializePlayoffGrid(snapshot);
  if (typeof CompressionStream === "undefined") return `FTPC1|${plain}`;
  return `${CUP_PREFIX}${await deflateBase64Url(plain)}`;
}

export async function decodePlayoffGrid(raw: string): Promise<PlayoffGridDecodeResult> {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  const compact = text.replace(/\s+/g, "");
  if (compact.startsWith(CUP_PREFIX)) {
    try {
      return parsePlayoffGrid(await inflateBase64Url(compact.slice(CUP_PREFIX.length)));
    } catch {
      return { ok: false, error: "Код сетки плей-офф не раскрылся. Покажите QR ещё раз." };
    }
  }
  if (text.startsWith("FTPC1|")) return parsePlayoffGrid(text.slice("FTPC1|".length));
  return { ok: false, error: "Это не стартовый код плей-офф" };
}

export function parsePlayoffGrid(plain: string): PlayoffGridDecodeResult {
  const lines = plain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
  const splitAt = lines.indexOf("#");
  if (lines[0] !== "1" || splitAt < 9) return { ok: false, error: "Код сетки плей-офф повреждён" };

  const players: PlayoffGridPlayer[] = [];
  const seenBibs = new Set<number>();
  const seenSeeds = new Set<number>();
  for (const line of lines.slice(1, splitAt)) {
    const [bibText, nameText, placeText, seedText] = line.split("\t");
    const bibNumber = Number(bibText);
    const place = Number(placeText);
    const seed = Number(seedText);
    const displayName = unescapeField(nameText ?? "").trim().replace(/\s+/g, " ");
    if (!isBib(bibNumber) || !isCupPlace(place) || !isCupSeed(seed) || displayName.length === 0 || displayName.length > 120) {
      return { ok: false, error: "В коде сетки повреждён участник" };
    }
    if (seenBibs.has(bibNumber)) return { ok: false, error: "В коде сетки повторяется номер" };
    if (seenSeeds.has(seed)) return { ok: false, error: "В коде сетки повторяется посев" };
    seenBibs.add(bibNumber);
    seenSeeds.add(seed);
    players.push({ bibNumber, displayName, place, seed });
  }
  if (players.length !== 8 || seenSeeds.size !== 8) return { ok: false, error: "В коде сетки должны быть 8 финалистов" };

  const bySeed = new Map(players.map((player) => [player.seed, player]));
  const pairs: PlayoffGridPair[] = [];
  const seenPairs = new Set<number>();
  const seenInPairs = new Set<number>();
  for (const line of lines.slice(splitAt + 1)) {
    const match = /^([1-4])=(\d+)\/(\d+)$/.exec(line);
    if (!match) return { ok: false, error: "В коде сетки повреждена пара 1/4" };
    const pair = Number(match[1]);
    const bibA = Number(match[2]);
    const bibB = Number(match[3]);
    if (seenPairs.has(pair)) return { ok: false, error: "В коде сетки повторяется пара" };
    const [seedA, seedB] = CUP_PAIR_SEEDS[pair - 1] ?? [0, 0];
    const left = bySeed.get(seedA);
    const right = bySeed.get(seedB);
    if (!left || !right || left.bibNumber !== bibA || right.bibNumber !== bibB) {
      return { ok: false, error: "Пары 1/4 не совпадают с посевом 1–8, 2–7, 3–6, 4–5" };
    }
    if (seenInPairs.has(bibA) || seenInPairs.has(bibB)) return { ok: false, error: "В парах 1/4 номер стоит дважды" };
    seenPairs.add(pair);
    seenInPairs.add(bibA);
    seenInPairs.add(bibB);
    pairs.push({ pair, bibA, bibB });
  }
  if (pairs.length !== 4) return { ok: false, error: "В коде сетки должны быть 4 пары 1/4" };

  return { ok: true, snapshot: { players, pairs } };
}

function isBib(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_FISH;
}

function isCupSeed(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

function isCupPlace(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 99;
}

function periodKey(round: RoundIndex, period: PeriodIndex): string {
  return `${round}.${period}`;
}

function parsePeriodKey(key: string): { round: RoundIndex; period: PeriodIndex } | null {
  const [roundText, periodText] = key.split(".");
  const round = Number(roundText);
  const period = Number(periodText);
  if (!isRound(round) || !isPeriod(period)) return null;
  return { round, period };
}

function nonNegative(fish: number): number {
  if (!Number.isFinite(fish)) return 0;
  return Math.max(0, Math.min(MAX_FISH, Math.trunc(fish)));
}

function isRound(value: number): value is RoundIndex {
  return value === 1 || value === 2;
}

function isPeriod(value: number): value is PeriodIndex {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}
