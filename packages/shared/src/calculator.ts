import {
  QUALIFYING_PERIODS,
  type DuelPoints,
  type DuelResult,
  type FishCount,
  type GridSlot,
  type GroupId,
  type LeaderboardEntry,
  type LoneNeighborInput,
  type MatrixDuel,
  type PeriodIndex,
  type PeriodPoints,
  type PeriodResult,
  type PlayoffBracketMatch,
  type PlayoffDecision,
  type PlayoffDuelInput,
  type PlayoffPairing,
  type PlayoffProjection,
  type PlayoffSeed,
  type PlayoffStage,
  type RoundIndex,
  type ScoredAthlete,
  type Side,
  type TournamentCalculator,
  type TournamentEvent,
  type VirtualDuelResult,
} from "./types.js";

/**
 * Очки одного спортсмена:
 * 0 рыб → 0; больше соперника → 4; поровну и оба поймали → 2; меньше, но рыба есть → 1.
 */
export function scoreDuel(fishA: FishCount, fishB: FishCount): DuelPoints {
  const a = normalizeFish(fishA);
  const b = normalizeFish(fishB);

  if (a === 0 && b === 0) {
    return { outcome: "blank", a: { fish: 0, points: 0 }, b: { fish: 0, points: 0 } };
  }

  if (a === b) {
    return { outcome: "draw", fish: a, a: { points: 2 }, b: { points: 2 } };
  }

  if (a > b) {
    return {
      outcome: "win",
      winner: "a",
      winnerFish: a,
      loserFish: b,
      winnerPoints: 4,
      loserPoints: b > 0 ? 1 : 0,
    };
  }

  return {
    outcome: "win",
    winner: "b",
    winnerFish: b,
    loserFish: a,
    winnerPoints: 4,
    loserPoints: a > 0 ? 1 : 0,
  };
}

/** Очки спортсмена против соперника. 4 победа, 2 ничья, 1 поражение с рыбой, 0 ноль поимок. */
export function pointsAgainst(ownFish: FishCount, opponentFish: FishCount): PeriodPoints {
  return sidePoints(scoreDuel(ownFish, opponentFish), "a");
}

/**
 * Кубковая дуэль PAL Trout 2026.
 * 1. Больше рыб в основное время.
 * 2. Ничья основного времени — доп. 5 минут.
 * 3. Ничья доп. времени — «Золотая рыба»: больше рыб, либо кто поймал первым при равном ненулевом счёте.
 * 4. Только 0:0 в золотой рыбе отдаёт победу более высокому месту группы (меньший place, затем меньший seed).
 */
export function scorePlayoffDuel(input: PlayoffDuelInput): PlayoffDecision {
  const fishA = normalizeFish(input.fishA);
  const fishB = normalizeFish(input.fishB);
  const blank: PlayoffDecision = {
    winner: null,
    fishA,
    fishB,
    extraFishA: null,
    extraFishB: null,
    goldenFishA: null,
    goldenFishB: null,
    goldenFirst: null,
    decidedBy: null,
  };

  if (fishA !== fishB) {
    return { ...blank, winner: fishA > fishB ? "a" : "b", decidedBy: "regulation" };
  }

  const extraFishA = normalizeFish(input.extraFishA ?? 0);
  const extraFishB = normalizeFish(input.extraFishB ?? 0);
  const afterExtra: PlayoffDecision = { ...blank, extraFishA, extraFishB };
  if (extraFishA !== extraFishB) {
    return { ...afterExtra, winner: extraFishA > extraFishB ? "a" : "b", decidedBy: "extraTime" };
  }

  const goldenFishA = normalizeFish(input.goldenFishA ?? 0);
  const goldenFishB = normalizeFish(input.goldenFishB ?? 0);
  const afterGolden: PlayoffDecision = {
    ...afterExtra,
    goldenFishA,
    goldenFishB,
    goldenFirst: input.goldenFirst === "a" || input.goldenFirst === "b" ? input.goldenFirst : null,
  };
  if (goldenFishA !== goldenFishB) {
    const winner = goldenFishA > goldenFishB ? "a" : "b";
    return { ...afterGolden, winner, goldenFirst: winner, decidedBy: "goldenFish" };
  }
  if (goldenFishA > 0) {
    if (afterGolden.goldenFirst) {
      return { ...afterGolden, winner: afterGolden.goldenFirst, decidedBy: "goldenFish" };
    }
    return { ...afterGolden, winner: null, goldenFirst: null, decidedBy: null };
  }

  return {
    ...afterGolden,
    goldenFirst: null,
    winner: betterQualifier(input.placeA, input.seedA, input.placeB, input.seedB),
    decidedBy: "qualifyingPlace",
  };
}

export function calculateDuels(events: readonly TournamentEvent[]): DuelResult[] {
  const state = reduceEvents(events);
  return assignmentsOf(state)
    .filter((assignment) => assignment.kind === "pair" || assignment.neighborSlotId !== null)
    .map((assignment) => toDuelResult(state, assignment))
    .sort(compareDuels);
}

export function generateLeaderboard(events: readonly TournamentEvent[]): LeaderboardEntry[] {
  const state = reduceEvents(events);
  const duels = calculateDuels(events);
  const lastRound = state.lastRound;

  const rows = [...state.slots.values()].map((slot) => {
    let points = 0;
    let opponentFishCount = 0;

    for (const duel of duels) {
      if (duel.kind === "pair") {
        if (duel.a.slotId === slot.slotId) {
          points += duel.a.points;
          opponentFishCount += duel.b.fish;
        } else if (duel.b.slotId === slot.slotId) {
          points += duel.b.points;
          opponentFishCount += duel.a.fish;
        }
      } else if (duel.lone.slotId === slot.slotId) {
        points += duel.lone.points;
        opponentFishCount += duel.neighborFish;
      }
    }

    return {
      place: 0,
      slotId: slot.slotId,
      bibNumber: slot.bibNumber,
      groupId: slot.groupId,
      displayName: slot.displayName,
      points,
      fishCount: totalFish(state, slot.slotId),
      opponentFishCount,
      lastRoundFish: fishInRound(state, slot.slotId, lastRound),
      periods: periodResults(state, slot.slotId, duels),
    };
  });

  rows.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points;
    if (right.fishCount !== left.fishCount) return right.fishCount - left.fishCount;
    return left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId);
  });

  for (let index = 0; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (!current) continue;
    const tied =
      previous !== undefined &&
      previous.points === current.points &&
      previous.fishCount === current.fishCount;
    current.place = tied ? previous.place : index + 1;
  }

  return rows;
}

const SCHEDULE_PERIODS: readonly PeriodIndex[] = QUALIFYING_PERIODS;

/** Виртуальный соперник нечётного состава. В сетку слотом не сажается: живой в этом туре один. */
export const GHOST_ID = "GHOST";

export function isGhostOpponent(slotId: string | null | undefined): boolean {
  return slotId == null || slotId === GHOST_ID;
}

/**
 * Стартовый борт и чередование, если других сведений нет.
 * Период 1: нечётный номер слева, чётный справа. Дальше борт меняется каждый период.
 * В сетке борт пары и одиночки берётся из их собственной истории, а не только из этой формулы.
 */
export function bankSide(bibNumber: number, periodNumber: number): Side {
  const oddBib = Math.abs(bibNumber) % 2 === 1;
  let side: Side = oddBib ? "left" : "right";
  const period = Number.isInteger(periodNumber) && periodNumber > 1 ? periodNumber : 1;
  for (let current = 1; current < period; current += 1) {
    side = side === "left" ? "right" : "left";
  }
  return side;
}

export interface SectorMapSeat {
  sectorId: string;
  order: number;
  leftSlotId: string | null;
  rightSlotId: string | null;
}

/**
 * Сосед для сравнения одиночки по карте секторов этого периода.
 * Сначала сектор в сторону пустого борта, из него — место, которое смотрит на одиночку.
 */
export function comparisonNeighborId(seats: readonly SectorMapSeat[], loneSlotId: string): string | null {
  const ordered = [...seats].sort(
    (left, right) => left.order - right.order || left.sectorId.localeCompare(right.sectorId, undefined, { numeric: true }),
  );
  const sectorIndex = ordered.findIndex(
    (seat) => seat.leftSlotId === loneSlotId || seat.rightSlotId === loneSlotId,
  );
  if (sectorIndex < 0) return null;

  const loneOnLeft = ordered[sectorIndex]?.leftSlotId === loneSlotId;
  const nearestFirst = loneOnLeft ? [sectorIndex + 1, sectorIndex - 1] : [sectorIndex - 1, sectorIndex + 1];
  for (const index of nearestFirst) {
    const adjacent = ordered[index];
    if (!adjacent) continue;
    const towardLone =
      index > sectorIndex
        ? [adjacent.leftSlotId, adjacent.rightSlotId]
        : [adjacent.rightSlotId, adjacent.leftSlotId];
    for (const candidate of towardLone) {
      if (candidate && candidate !== loneSlotId && candidate !== GHOST_ID) return candidate;
    }
  }
  return null;
}

/** Сосед одиночки из уже построенной сетки. Борт берётся из слота жеребьёвки. */
export function comparisonNeighborFromGrid(
  grid: readonly GridSlot[],
  loneSlotId: string,
  period: PeriodIndex,
  round: RoundIndex = 1,
  skipSlotIds?: ReadonlySet<string>,
): string | null {
  const seats = new Map<string, SectorMapSeat>();
  for (const slot of grid) {
    if (slot.round !== round || slot.period !== period) continue;
    if (slot.slotId === GHOST_ID || skipSlotIds?.has(slot.slotId)) continue;
    const parsed = Number(slot.sectorId);
    const seat = seats.get(slot.sectorId) ?? {
      sectorId: slot.sectorId,
      order: Number.isFinite(parsed) ? parsed : 0,
      leftSlotId: null,
      rightSlotId: null,
    };
    if (slot.side === "right") seat.rightSlotId = slot.slotId;
    else seat.leftSlotId = slot.slotId;
    seats.set(slot.sectorId, seat);
  }
  return comparisonNeighborId([...seats.values()], loneSlotId);
}

/**
 * Сетка отбора.
 * `participantIds` идут в порядке жеребьёвки. Номер — позиция в этом списке, если `bibNumbers` не переданы.
 * Нечётный состав дополняется одним GHOST: кому он выпал, тот в периоде один.
 * Период 1 — только чётный с нечётным, пары и сектора перемешаны, а не 1 со 2 в секторе 1.
 * Со 2-го периода чётный может встретить чётного, нечётный — нечётного.
 * Сначала закрываются новые пары. Повтор меняет борта местами и садится в другой сектор.
 * Один и тот же сектор два периода подряд не берётся. Возврат позже возможен, но реже, и тогда борт меняется относительно прошлого визита.
 * Борт каждого номера по возможности меняется каждый период. Повтор борта допустим, длинная серия на одной стороне — нет.
 * Одинаковые номера не дают один и тот же лист: расклад зависит и от id участников. Один и тот же список при этом не прыгает.
 */
export function generateTournamentGrid(
  participantIds: readonly string[],
  periodsCount: number,
  bibNumbers?: readonly number[],
): GridSlot[] {
  const ids = uniqueIds(participantIds);
  if (ids.length === 0 || !Number.isInteger(periodsCount) || periodsCount < 1) return [];

  const periods = Math.min(SCHEDULE_PERIODS.length, periodsCount);
  const athletes = ids.map((slotId, index) => ({
    slotId,
    bibNumber: bibNumbers && bibNumbers.length === ids.length ? (bibNumbers[index] ?? index + 1) : index + 1,
  }));
  const bibOf = new Map(athletes.map((athlete) => [athlete.slotId, athlete.bibNumber]));
  const field = athletes.map((athlete) => athlete.slotId);
  if (field.length % 2 === 1) field.push(GHOST_ID);
  const seed = mixSeed(athletes.flatMap((athlete) => [athlete.bibNumber, athlete.slotId]));
  const meetings = new Map<string, PairMemory[]>();
  const sectorVisits = new Map<string, number[]>();
  const lastSector = new Map<string, number>();
  const sectorSides = new Map<string, Map<number, Side>>();
  const byeCount = new Map<string, number>();
  const banks = new Map<string, BankLedger>();
  const slots: GridSlot[] = [];

  for (let offset = 0; offset < periods; offset += 1) {
    const period = SCHEDULE_PERIODS[offset] ?? 1;
    const crossOnly = period === 1;
    const pairs = bestFieldMatching(field, bibOf, meetings, byeCount, banks, lastSector, sectorSides, seed, period, crossOnly);
    const chosen = pairs.length > 0 ? pairs : bestFieldMatching(field, bibOf, meetings, byeCount, banks, lastSector, sectorSides, seed, period, false);
    const meets = chosen.map(([leftId, rightId]) => ({
      leftId,
      rightId,
      rematchSectors: new Set((meetings.get(pairKey(leftId, rightId)) ?? []).map((meeting) => meeting.sector)),
    }));
    const sectors = assignMeetSectors(meets, bibOf, sectorVisits, lastSector, sectorSides, banks, seed, period);
    meets.forEach((meet, index) => {
      const sector = sectors[index] ?? index;
      const sectorId = String(sector + 1);
      const ghostMeet = meet.leftId === GHOST_ID || meet.rightId === GHOST_ID;
      if (ghostMeet) {
        const loneId = meet.leftId === GHOST_ID ? meet.rightId : meet.leftId;
        const loneSide = sectorBank(loneId, sector, sectorSides) ?? preferredBank(banks.get(loneId), bibOf.get(loneId) ?? 0);
        slots.push(gridPlace(loneId, GHOST_ID, loneSide, period, sectorId, bibOf));
        rememberBank(banks, loneId, loneSide);
        rememberSector(sectorVisits, lastSector, loneId, sector);
        rememberSectorSide(sectorSides, loneId, sector, loneSide);
        byeCount.set(loneId, (byeCount.get(loneId) ?? 0) + 1);
        return;
      }
      const memory = meetings.get(pairKey(meet.leftId, meet.rightId)) ?? [];
      const oriented = orientPair(meet.leftId, meet.rightId, memory, bibOf, banks, sectorSides, sector, seed, period);
      slots.push(gridPlace(oriented.leftId, oriented.rightId, "left", period, sectorId, bibOf));
      slots.push(gridPlace(oriented.rightId, oriented.leftId, "right", period, sectorId, bibOf));
      rememberBank(banks, oriented.leftId, "left");
      rememberBank(banks, oriented.rightId, "right");
      rememberSectorSide(sectorSides, oriented.leftId, sector, "left");
      rememberSectorSide(sectorSides, oriented.rightId, sector, "right");
      const nextMemory = meetings.get(pairKey(meet.leftId, meet.rightId)) ?? [];
      nextMemory.push({ period, sector, leftId: oriented.leftId, rightId: oriented.rightId });
      meetings.set(pairKey(meet.leftId, meet.rightId), nextMemory);
      rememberSector(sectorVisits, lastSector, meet.leftId, sector);
      rememberSector(sectorVisits, lastSector, meet.rightId, sector);
    });
  }

  return slots.sort(compareGridSlots);
}

export function readTransitionGrid(events: readonly TournamentEvent[]): GridSlot[] {
  const state = reduceEvents(events);
  const slots: GridSlot[] = [];

  for (const duel of state.matrix) {
    if (duel.kind === "pair") {
      slots.push(gridSlot(state, duel, duel.leftSlotId, duel.rightSlotId));
      slots.push(gridSlot(state, duel, duel.rightSlotId, duel.leftSlotId));
    } else {
      slots.push(gridSlot(state, duel, duel.loneSlotId, null));
    }
  }

  return slots.sort(compareGridSlots);
}

const QUARTERFINAL_SEEDS: readonly (readonly [number, number])[] = [
  [1, 8],
  [2, 7],
  [3, 6],
  [4, 5],
];

/** Полуфинал: победитель 1–8 с победителем 4–5, победитель 2–7 с победителем 3–6. */
const SEMIFINAL_SOURCES: readonly (readonly [number, number])[] = [
  [0, 3],
  [1, 2],
];

export const emptyPlayoffProjection: PlayoffProjection = {
  formed: false,
  seeds: [],
  quarterfinals: [],
  semifinals: [],
  final: null,
  thirdPlace: null,
};

/** Первые восемь строк таблицы. seed — порядок, place — место отбора. */
export function seedsFromRanking(entries: readonly LeaderboardEntry[]): PlayoffSeed[] | null {
  if (entries.length < 8) return null;
  const top = entries.slice(0, 8);
  if (new Set(top.map((entry) => entry.slotId)).size !== 8) return null;
  return top.map((entry, index) => ({
    slotId: entry.slotId,
    place: entry.place,
    seed: index + 1,
  }));
}

/** 1vs8, 2vs7, 3vs6, 4vs5. На стороне A — более высокий посев. */
export function buildQuarterfinals(seeds: readonly PlayoffSeed[]): PlayoffPairing[] | null {
  if (seeds.length !== 8) return null;
  const bySeed = new Map(seeds.map((seed) => [seed.seed, seed]));
  const pairs: PlayoffPairing[] = [];
  for (let order = 0; order < QUARTERFINAL_SEEDS.length; order += 1) {
    const [seedA, seedB] = QUARTERFINAL_SEEDS[order] ?? [0, 0];
    const a = bySeed.get(seedA);
    const b = bySeed.get(seedB);
    if (!a || !b) return null;
    pairs.push({
      matchId: `qf-${order}`,
      stage: "quarterfinal",
      order,
      slotIdA: a.slotId,
      slotIdB: b.slotId,
      seedA: a.seed,
      seedB: b.seed,
      placeA: a.place,
      placeB: b.place,
    });
  }
  return pairs;
}

export function playoffMatches(projection: PlayoffProjection): PlayoffBracketMatch[] {
  if (!projection.formed || !projection.final || !projection.thirdPlace) return [];
  return [...projection.quarterfinals, ...projection.semifinals, projection.final, projection.thirdPlace];
}

/** Сетка кубка. Очки отбора не меняет: события плей-офф в таблицу не входят. */
export function projectPlayoff(events: readonly TournamentEvent[]): PlayoffProjection {
  const ordered = [...events]
    .filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index)
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));

  let formed: Extract<TournamentEvent, { type: "FORM_PLAYOFF" }> | null = null;
  const scores = new Map<string, PlayoffScore>();
  const sides = new Map<string, Map<string, number>>();
  for (const event of ordered) {
    if (event.type === "FORM_PLAYOFF") formed = event;
    if (event.type === "PLAYOFF_DUEL_SCORED") {
      sides.delete(event.payload.matchId);
      scores.set(event.payload.matchId, duelScoreFromEvent(event.payload));
    }
    if (event.type === "PLAYOFF_SIDE_REPORTED") {
      const score = scores.get(event.payload.matchId);
      if (
        score &&
        score.fishA !== null &&
        score.fishB !== null &&
        (event.payload.slotId === score.slotIdA || event.payload.slotId === score.slotIdB)
      ) {
        scores.set(event.payload.matchId, {
          ...score,
          fishA: event.payload.slotId === score.slotIdA ? event.payload.fish : score.fishA,
          fishB: event.payload.slotId === score.slotIdB ? event.payload.fish : score.fishB,
        });
      } else {
        const bucket = new Map(sides.get(event.payload.matchId) ?? []);
        bucket.set(event.payload.slotId, event.payload.fish);
        sides.set(event.payload.matchId, bucket);
      }
    }
  }
  if (!formed || formed.payload.quarterfinals.length !== 4 || formed.payload.seeds.length !== 8) {
    return emptyPlayoffProjection;
  }

  return assemblePlayoff(formed.payload.seeds, formed.payload.quarterfinals, resolvePlayoffScore(scores, sides));
}

/** Черновик строк дуэли, пока окно ввода ещё не подтверждено. */
export interface PlayoffDraftLines {
  fishA: FishCount;
  fishB: FishCount;
  extraFishA?: FishCount;
  extraFishB?: FishCount;
  goldenFishA?: FishCount;
  goldenFishB?: FishCount;
  goldenFirst?: "a" | "b" | null;
}

/**
 * Черновик поимок поверх уже собранной сетки.
 * Победитель, финал и матч за 3-е место считаются тем же регламентом, что и при записи дуэли.
 * Счёт следующего раунда сохраняется, только если в паре остались те же спортсмены.
 */
export function previewPlayoffScore(
  projection: PlayoffProjection,
  matchId: string,
  lines: PlayoffDraftLines,
): PlayoffProjection {
  if (!projection.formed || !projection.final || !projection.thirdPlace) return projection;
  const pairings = projection.quarterfinals.map(matchToPairing);
  if (pairings.some((pairing) => pairing === null)) return projection;
  const target = playoffMatches(projection).find((match) => match.matchId === matchId);
  if (!target?.slotIdA || !target.slotIdB) return projection;

  const scores = scoresFromProjection(projection);
  scores.set(matchId, {
    matchId,
    slotIdA: target.slotIdA,
    slotIdB: target.slotIdB,
    fishA: lines.fishA,
    fishB: lines.fishB,
    extraFishA: normalizeFish(lines.extraFishA ?? 0),
    extraFishB: normalizeFish(lines.extraFishB ?? 0),
    goldenFishA: normalizeFish(lines.goldenFishA ?? 0),
    goldenFishB: normalizeFish(lines.goldenFishB ?? 0),
    goldenFirst: lines.goldenFirst === "a" || lines.goldenFirst === "b" ? lines.goldenFirst : null,
  });
  return assemblePlayoff(
    projection.seeds,
    pairings.filter((pairing): pairing is PlayoffPairing => pairing !== null),
    resolvePlayoffScore(scores, new Map()),
  );
}

export function calculateLoneResult(
  events: readonly TournamentEvent[],
  loneId: string,
  neighbor: LoneNeighborInput,
): VirtualDuelResult {
  const state = reduceEvents(events);
  const neighborId = resolveNeighborId(loneId, neighbor);
  const period = resolveLonePeriod(state, loneId, neighbor);
  const loneFish = countedFish(state, loneId, period.round, period.period);
  const neighborFish = countedFish(state, neighborId, period.round, period.period);
  const comparison = scoreDuel(loneFish, neighborFish);

  return {
    loneId,
    neighborId,
    loneFish,
    neighborFish,
    lonePoints: sidePoints(comparison, "a"),
    comparison,
    awardedToNeighbor: false,
    neighborTransitionViolation: transitionViolation(state, neighborId, period.round, period.period),
  };
}

export const tournamentCalculator: TournamentCalculator = {
  scoreDuel,
  calculateDuels,
  generateLeaderboard,
  readTransitionGrid,
  scorePlayoffDuel,
  projectPlayoff,
  calculateLoneResult,
};

interface SlotState {
  slotId: string;
  bibNumber: number;
  groupId: GroupId;
  displayName: string;
  ghost: boolean;
}

interface PairAssignment {
  kind: "pair";
  source: "matrix" | "manual";
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string | null;
  slotIdA: string;
  slotIdB: string;
}

interface LoneAssignment {
  kind: "lone";
  source: "matrix" | "manual";
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string | null;
  loneSlotId: string;
  neighborSlotId: string | null;
}

type Assignment = PairAssignment | LoneAssignment;

interface TransitionFact {
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string;
  requested: boolean;
  requestedBySlotId: string | null;
}

interface ProtocolFact {
  slotIdA: string;
  slotIdB: string | null;
  signed: boolean;
}

interface TournamentState {
  slots: Map<string, SlotState>;
  matrix: MatrixDuel[];
  assignments: Map<string, Assignment>;
  comparisons: Map<string, string>;
  fish: Map<string, FishLedger>;
  yellow: Set<string>;
  red: Set<string>;
  protocols: Map<string, ProtocolFact[]>;
  transitions: TransitionFact[];
  lastRound: RoundIndex;
}

function reduceEvents(events: readonly TournamentEvent[]): TournamentState {
  const state: TournamentState = {
    slots: new Map(),
    matrix: [],
    assignments: new Map(),
    comparisons: new Map(),
    fish: new Map(),
    yellow: new Set(),
    red: new Set(),
    protocols: new Map(),
    transitions: [],
    lastRound: 1,
  };

  const ordered = [...events]
    .filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index)
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));

  for (const event of ordered) {
    switch (event.type) {
      case "TOURNAMENT_OPENED":
        state.lastRound = event.payload.rounds;
        break;
      case "PARTICIPANT_REGISTERED":
        state.slots.set(event.payload.slotId, {
          slotId: event.payload.slotId,
          bibNumber: event.payload.bibNumber,
          groupId: event.payload.groupId,
          displayName: event.payload.displayName,
          ghost: false,
        });
        break;
      case "DRAW_SEEDED":
        state.slots.clear();
        for (const slot of event.payload.slots) {
          state.slots.set(slot.slotId, {
            slotId: slot.slotId,
            bibNumber: slot.bibNumber,
            groupId: slot.groupId,
            displayName: slot.displayName,
            ghost: slot.ghost === true,
          });
        }
        state.matrix = [...event.payload.matrix];
        rebuildMatrixAssignments(state);
        break;
      case "DUEL_ASSIGNED":
        if (event.payload.kind === "pair") {
          ensureSlot(state, event.payload.slotIdA);
          ensureSlot(state, event.payload.slotIdB);
          putAssignment(state, {
            kind: "pair",
            source: "manual",
            round: event.payload.round,
            period: event.payload.period,
            sectorId: event.payload.sectorId,
            slotIdA: event.payload.slotIdA,
            slotIdB: event.payload.slotIdB,
          });
        } else {
          ensureSlot(state, event.payload.loneSlotId);
          ensureSlot(state, event.payload.neighborSlotId);
          putAssignment(state, {
            kind: "lone",
            source: "manual",
            round: event.payload.round,
            period: event.payload.period,
            sectorId: event.payload.sectorId,
            loneSlotId: event.payload.loneSlotId,
            neighborSlotId: event.payload.neighborSlotId,
          });
        }
        break;
      case "LONE_COMPARED":
        ensureSlot(state, event.payload.loneSlotId);
        ensureSlot(state, event.payload.neighborSlotId);
        state.comparisons.set(comparisonKey(event.payload.round, event.payload.period, event.payload.loneSlotId), event.payload.neighborSlotId);
        attachComparison(state, event.payload.round, event.payload.period, event.payload.loneSlotId);
        break;
      case "PARTICIPANT_REPLACED": {
        ensureSlot(state, event.payload.slotId);
        const replaced = state.slots.get(event.payload.slotId)!;
        replaced.displayName = event.payload.displayName;
        replaced.ghost = false;
        break;
      }
      case "PARTICIPANT_SET_GHOST": {
        ensureSlot(state, event.payload.slotId);
        const ghosted = state.slots.get(event.payload.slotId)!;
        ghosted.displayName = event.payload.displayName;
        ghosted.ghost = true;
        break;
      }
      case "PARTICIPANT_REMOVED":
        state.slots.delete(event.payload.slotId);
        break;
      case "CATCH_RECORDED": {
        ensureSlot(state, event.payload.slotId);
        const key = fishKey(event.payload.slotId, event.payload.round, event.payload.period);
        const ledger = state.fish.get(key) ?? blankLedger();
        if (ledger.sealed) {
          ledger.segment = 0;
          ledger.sealed = false;
        }
        ledger.segment += event.payload.delta;
        ledger.open = true;
        state.fish.set(key, ledger);
        break;
      }
      case "TRANSITION_DECIDED":
        state.transitions.push(event.payload);
        break;
      case "CARD_ISSUED":
        if (event.payload.card === "yellow") {
          state.yellow.add(fishKey(event.payload.slotId, event.payload.round, event.payload.period));
        } else {
          state.red.add(`${event.payload.slotId}:${event.payload.round}`);
        }
        break;
      case "FORM_PLAYOFF":
      case "PLAYOFF_DUEL_SCORED":
      case "PLAYOFF_SIDE_REPORTED":
      case "PERIOD_SIGNAL":
        break;
      case "PERIOD_COMPLETED": {
        const key = `${event.payload.round}:${event.payload.period}`;
        const covered = new Set<string>();
        for (const protocol of event.payload.protocols) {
          covered.add(protocol.slotIdA);
          if (protocol.slotIdB) covered.add(protocol.slotIdB);
          sealFish(state, protocol.slotIdA, event.payload.round, event.payload.period);
          if (protocol.slotIdB) sealFish(state, protocol.slotIdB, event.payload.round, event.payload.period);
        }
        const previous = state.protocols.get(key) ?? [];
        const kept = previous.filter(
          (protocol) => !covered.has(protocol.slotIdA) && (protocol.slotIdB === null || !covered.has(protocol.slotIdB)),
        );
        state.protocols.set(key, [...kept, ...event.payload.protocols]);
        break;
      }
      default:
        break;
    }
  }

  return state;
}

/**
 * Ближайший сосед одиночки в этом периоде по карте секторов.
 * Очки этой виртуальной дуэли соседу не начисляются.
 */
function nearestSectorNeighbor(
  state: TournamentState,
  round: RoundIndex,
  period: PeriodIndex,
  loneSlotId: string,
): string | null {
  const seats: SectorMapSeat[] = [];
  for (const duel of state.matrix) {
    if (duel.round !== round || duel.period !== period) continue;
    const parsed = Number(duel.sectorId);
    const seat: SectorMapSeat = {
      sectorId: duel.sectorId,
      order: Number.isFinite(parsed) ? parsed : 0,
      leftSlotId: null,
      rightSlotId: null,
    };
    if (duel.kind === "pair") {
      seat.leftSlotId = duel.leftSlotId;
      seat.rightSlotId = duel.rightSlotId;
    } else if (matrixBank(state, duel.loneSlotId, duel.round, duel.period) === "right") {
      seat.rightSlotId = duel.loneSlotId;
    } else {
      seat.leftSlotId = duel.loneSlotId;
    }
    seats.push(seat);
  }
  return comparisonNeighborId(seats, loneSlotId);
}

function rebuildMatrixAssignments(state: TournamentState): void {
  for (const [key, assignment] of state.assignments) {
    if (assignment.source === "matrix") state.assignments.delete(key);
  }

  for (const duel of state.matrix) {
    if (duel.kind === "pair") {
      putAssignment(state, {
        kind: "pair",
        source: "matrix",
        round: duel.round,
        period: duel.period,
        sectorId: duel.sectorId,
        slotIdA: duel.leftSlotId,
        slotIdB: duel.rightSlotId,
      });
    } else {
      const pinned = state.comparisons.get(comparisonKey(duel.round, duel.period, duel.loneSlotId));
      putAssignment(state, {
        kind: "lone",
        source: "matrix",
        round: duel.round,
        period: duel.period,
        sectorId: duel.sectorId,
        loneSlotId: duel.loneSlotId,
        neighborSlotId: pinned ?? nearestSectorNeighbor(state, duel.round, duel.period, duel.loneSlotId),
      });
    }
  }
}

function putAssignment(state: TournamentState, assignment: Assignment): void {
  const slotIds = assignment.kind === "pair" ? [assignment.slotIdA, assignment.slotIdB] : [assignment.loneSlotId];
  for (const slotId of slotIds) {
    const existingKey = assignmentKey(assignment.round, assignment.period, slotId);
    const existing = state.assignments.get(existingKey);
    if (!existing) continue;
    if (existing.kind === "pair") {
      state.assignments.delete(assignmentKey(existing.round, existing.period, existing.slotIdA));
      state.assignments.delete(assignmentKey(existing.round, existing.period, existing.slotIdB));
    } else {
      state.assignments.delete(assignmentKey(existing.round, existing.period, existing.loneSlotId));
    }
  }

  if (assignment.kind === "pair") {
    state.assignments.set(assignmentKey(assignment.round, assignment.period, assignment.slotIdA), assignment);
    state.assignments.set(assignmentKey(assignment.round, assignment.period, assignment.slotIdB), assignment);
    return;
  }

  state.assignments.set(assignmentKey(assignment.round, assignment.period, assignment.loneSlotId), assignment);
}

function attachComparison(state: TournamentState, round: RoundIndex, period: PeriodIndex, loneSlotId: string): void {
  const key = assignmentKey(round, period, loneSlotId);
  const existing = state.assignments.get(key);
  const neighborSlotId = state.comparisons.get(comparisonKey(round, period, loneSlotId)) ?? null;
  if (existing?.kind === "lone" && existing.loneSlotId === loneSlotId) {
    existing.neighborSlotId = neighborSlotId;
    return;
  }
  if (!existing) {
    putAssignment(state, {
      kind: "lone",
      source: "matrix",
      round,
      period,
      sectorId: null,
      loneSlotId,
      neighborSlotId,
    });
  }
}

function assignmentsOf(state: TournamentState): Assignment[] {
  const unique = new Set<Assignment>();
  for (const assignment of state.assignments.values()) unique.add(assignment);
  return [...unique];
}

function toDuelResult(state: TournamentState, assignment: Assignment): DuelResult {
  if (assignment.kind === "pair") {
    const fishA = countedFish(state, assignment.slotIdA, assignment.round, assignment.period);
    const fishB = countedFish(state, assignment.slotIdB, assignment.round, assignment.period);
    const points = scoreDuel(fishA, fishB);
    return {
      kind: "pair",
      round: assignment.round,
      period: assignment.period,
      sectorId: assignment.sectorId,
      source: assignment.source,
      a: scoredAthlete(state, assignment.slotIdA, fishA, sidePoints(points, "a")),
      b: scoredAthlete(state, assignment.slotIdB, fishB, sidePoints(points, "b")),
      points,
    };
  }

  const neighborId = assignment.neighborSlotId ?? "";
  const loneFish = countedFish(state, assignment.loneSlotId, assignment.round, assignment.period);
  const neighborFish = countedFish(state, neighborId, assignment.round, assignment.period);
  const comparison = scoreDuel(loneFish, neighborFish);
  return {
    kind: "lone",
    round: assignment.round,
    period: assignment.period,
    sectorId: assignment.sectorId,
    source: assignment.source,
    lone: scoredAthlete(state, assignment.loneSlotId, loneFish, sidePoints(comparison, "a")),
    neighborId,
    neighborFish,
    awardedToNeighbor: false,
    neighborTransitionViolation: transitionViolation(state, neighborId, assignment.round, assignment.period),
  };
}

/**
 * Поимки слота за период. Повторное закрытие периода заменяет прошлый итог:
 * дельты после предыдущего PERIOD_COMPLETED начинают счёт заново.
 */
interface FishLedger {
  committed: number;
  segment: number;
  sealed: boolean;
  open: boolean;
}

function blankLedger(): FishLedger {
  return { committed: 0, segment: 0, sealed: false, open: false };
}

function sealFish(state: TournamentState, slotId: string, round: RoundIndex, period: PeriodIndex): void {
  const key = fishKey(slotId, round, period);
  const ledger = state.fish.get(key) ?? blankLedger();
  ledger.committed = ledger.segment;
  ledger.sealed = true;
  ledger.open = false;
  ledger.segment = 0;
  state.fish.set(key, ledger);
}

function ledgerFish(ledger: FishLedger | undefined): number {
  if (!ledger) return 0;
  return ledger.sealed ? ledger.committed : ledger.segment;
}

function periodPlayed(ledger: FishLedger | undefined): boolean {
  if (!ledger) return false;
  return ledger.sealed || ledger.open;
}

function countedFish(state: TournamentState, slotId: string, round: RoundIndex, period: PeriodIndex): FishCount {
  if (state.red.has(`${slotId}:${round}`)) return 0;
  const key = fishKey(slotId, round, period);
  if (state.yellow.has(key)) return 0;
  if (isUnsigned(state, slotId, round, period)) return 0;
  return normalizeFish(ledgerFish(state.fish.get(key)));
}

function periodResults(state: TournamentState, slotId: string, duels: readonly DuelResult[]): PeriodResult[] {
  return SCHEDULE_PERIODS.map((period) => {
    const ledger = state.fish.get(fishKey(slotId, 1, period));
    const played = periodPlayed(ledger);
    const fish = countedFish(state, slotId, 1, period);
    return {
      period,
      played,
      points: played ? periodPoints(duels, slotId, period) : 0,
      fish: played ? fish : 0,
      opponentFish: played ? opponentFishInPeriod(duels, slotId, period) : 0,
    };
  });
}

function opponentFishInPeriod(duels: readonly DuelResult[], slotId: string, period: PeriodIndex): FishCount {
  for (const duel of duels) {
    if (duel.round !== 1 || duel.period !== period) continue;
    if (duel.kind === "pair") {
      if (duel.a.slotId === slotId) return duel.b.fish;
      if (duel.b.slotId === slotId) return duel.a.fish;
    } else if (duel.lone.slotId === slotId) {
      return duel.neighborFish;
    }
  }
  return 0;
}

function periodPoints(duels: readonly DuelResult[], slotId: string, period: PeriodIndex): PeriodPoints {
  for (const duel of duels) {
    if (duel.round !== 1 || duel.period !== period) continue;
    if (duel.kind === "pair") {
      if (duel.a.slotId === slotId) return duel.a.points;
      if (duel.b.slotId === slotId) return duel.b.points;
    } else if (duel.lone.slotId === slotId) {
      return duel.lone.points;
    }
  }
  return 0;
}

function totalFish(state: TournamentState, slotId: string): FishCount {
  let total = 0;
  for (const round of [1, 2] as const) {
    total += fishInRound(state, slotId, round);
  }
  return total;
}

function fishInRound(state: TournamentState, slotId: string, round: RoundIndex): FishCount {
  let total = 0;
  for (const period of SCHEDULE_PERIODS) {
    total += countedFish(state, slotId, round, period);
  }
  return total;
}

function betterQualifier(placeA: number, seedA: number, placeB: number, seedB: number): "a" | "b" {
  if (placeA !== placeB) return placeA < placeB ? "a" : "b";
  if (seedA !== seedB) return seedA < seedB ? "a" : "b";
  return "a";
}

interface PlayoffScore {
  matchId: string;
  slotIdA: string;
  slotIdB: string;
  fishA: FishCount | null;
  fishB: FishCount | null;
  extraFishA: FishCount;
  extraFishB: FishCount;
  goldenFishA: FishCount;
  goldenFishB: FishCount;
  goldenFirst: "a" | "b" | null;
}

const UNSCORED_LINES = {
  fishA: null,
  fishB: null,
  extraFishA: null,
  extraFishB: null,
  goldenFishA: null,
  goldenFishB: null,
  goldenFirst: null,
  winnerSlotId: null,
  decidedBy: null,
} as const;

function duelScoreFromEvent(payload: Extract<TournamentEvent, { type: "PLAYOFF_DUEL_SCORED" }>["payload"]): PlayoffScore {
  return {
    matchId: payload.matchId,
    slotIdA: payload.slotIdA,
    slotIdB: payload.slotIdB,
    fishA: payload.fishA,
    fishB: payload.fishB,
    extraFishA: normalizeFish(payload.extraFishA ?? 0),
    extraFishB: normalizeFish(payload.extraFishB ?? 0),
    goldenFishA: normalizeFish(payload.goldenFishA ?? 0),
    goldenFishB: normalizeFish(payload.goldenFishB ?? 0),
    goldenFirst: payload.goldenFirst === "a" || payload.goldenFirst === "b" ? payload.goldenFirst : null,
  };
}

type PlayoffScoreLookup = (matchId: string, slotIdA: string, slotIdB: string) => PlayoffScore | undefined;

function resolvePlayoffScore(
  scores: ReadonlyMap<string, PlayoffScore>,
  sides: ReadonlyMap<string, ReadonlyMap<string, number>>,
): PlayoffScoreLookup {
  return (matchId, slotIdA, slotIdB) => {
    const stored = scores.get(matchId);
    if (stored && stored.slotIdA === slotIdA && stored.slotIdB === slotIdB && stored.fishA !== null && stored.fishB !== null) {
      return stored;
    }
    const reported = sides.get(matchId);
    const fishA = reported?.get(slotIdA);
    const fishB = reported?.get(slotIdB);
    if (fishA === undefined && fishB === undefined) {
      if (stored && stored.slotIdA === slotIdA && stored.slotIdB === slotIdB) return stored;
      return undefined;
    }
    return {
      matchId,
      slotIdA,
      slotIdB,
      fishA: fishA ?? null,
      fishB: fishB ?? null,
      extraFishA: 0,
      extraFishB: 0,
      goldenFishA: 0,
      goldenFishB: 0,
      goldenFirst: null,
    };
  };
}

interface PlayoffAdvanced {
  slotId: string;
  seed: number;
  place: number;
}

function pairingToMatch(pairing: PlayoffPairing): PlayoffBracketMatch {
  return {
    matchId: pairing.matchId,
    stage: pairing.stage,
    order: pairing.order,
    slotIdA: pairing.slotIdA,
    slotIdB: pairing.slotIdB,
    seedA: pairing.seedA,
    seedB: pairing.seedB,
    placeA: pairing.placeA,
    placeB: pairing.placeB,
    ...UNSCORED_LINES,
  };
}

function blankPlayoffMatch(matchId: string, stage: PlayoffStage, order: number): PlayoffBracketMatch {
  return {
    matchId,
    stage,
    order,
    slotIdA: null,
    slotIdB: null,
    seedA: null,
    seedB: null,
    placeA: null,
    placeB: null,
    ...UNSCORED_LINES,
  };
}

function applyPlayoffScore(match: PlayoffBracketMatch, score: PlayoffScore | undefined): PlayoffBracketMatch {
  if (!score || !match.slotIdA || !match.slotIdB) return match;
  if (score.slotIdA !== match.slotIdA || score.slotIdB !== match.slotIdB) return match;
  if (match.placeA === null || match.placeB === null || match.seedA === null || match.seedB === null) return match;
  if (score.fishA === null || score.fishB === null) {
    return {
      ...match,
      ...UNSCORED_LINES,
      fishA: score.fishA,
      fishB: score.fishB,
    };
  }
  const decision = scorePlayoffDuel({
    fishA: score.fishA,
    fishB: score.fishB,
    extraFishA: score.extraFishA,
    extraFishB: score.extraFishB,
    goldenFishA: score.goldenFishA,
    goldenFishB: score.goldenFishB,
    goldenFirst: score.goldenFirst,
    placeA: match.placeA,
    seedA: match.seedA,
    placeB: match.placeB,
    seedB: match.seedB,
  });
  return {
    ...match,
    fishA: decision.fishA,
    fishB: decision.fishB,
    extraFishA: decision.extraFishA,
    extraFishB: decision.extraFishB,
    goldenFishA: decision.goldenFishA,
    goldenFishB: decision.goldenFishB,
    goldenFirst: decision.goldenFirst,
    winnerSlotId: decision.winner === "a" ? match.slotIdA : decision.winner === "b" ? match.slotIdB : null,
    decidedBy: decision.decidedBy,
  };
}

function assemblePlayoff(
  seeds: readonly PlayoffSeed[],
  quarterPairings: readonly PlayoffPairing[],
  lookup: PlayoffScoreLookup,
): PlayoffProjection {
  if (quarterPairings.length !== 4 || seeds.length !== 8) return emptyPlayoffProjection;
  const quarterfinals = quarterPairings.map((pairing) =>
    applyPlayoffScore(pairingToMatch(pairing), lookup(pairing.matchId, pairing.slotIdA, pairing.slotIdB)),
  );
  const semifinals = SEMIFINAL_SOURCES.map((sources, order) =>
    advancePlayoff(`sf-${order}`, "semifinal", order, [quarterfinals[sources[0]], quarterfinals[sources[1]]], lookup, "winner"),
  );
  const finalMatch = advancePlayoff("final", "final", 0, [semifinals[0], semifinals[1]], lookup, "winner");
  const thirdPlace = advancePlayoff("third", "third", 0, [semifinals[0], semifinals[1]], lookup, "loser");
  return {
    formed: true,
    seeds,
    quarterfinals,
    semifinals,
    final: finalMatch,
    thirdPlace,
  };
}

function scoresFromProjection(projection: PlayoffProjection): Map<string, PlayoffScore> {
  const scores = new Map<string, PlayoffScore>();
  if (!projection.final || !projection.thirdPlace) return scores;
  for (const match of playoffMatches(projection)) {
    if (!match.slotIdA || !match.slotIdB || (match.fishA === null && match.fishB === null)) continue;
    scores.set(match.matchId, {
      matchId: match.matchId,
      slotIdA: match.slotIdA,
      slotIdB: match.slotIdB,
      fishA: match.fishA,
      fishB: match.fishB,
      extraFishA: match.extraFishA ?? 0,
      extraFishB: match.extraFishB ?? 0,
      goldenFishA: match.goldenFishA ?? 0,
      goldenFishB: match.goldenFishB ?? 0,
      goldenFirst: match.goldenFirst,
    });
  }
  return scores;
}

function matchToPairing(match: PlayoffBracketMatch): PlayoffPairing | null {
  if (
    match.stage !== "quarterfinal" ||
    !match.slotIdA ||
    !match.slotIdB ||
    match.seedA === null ||
    match.seedB === null ||
    match.placeA === null ||
    match.placeB === null
  ) {
    return null;
  }
  return {
    matchId: match.matchId,
    stage: "quarterfinal",
    order: match.order,
    slotIdA: match.slotIdA,
    slotIdB: match.slotIdB,
    seedA: match.seedA,
    seedB: match.seedB,
    placeA: match.placeA,
    placeB: match.placeB,
  };
}

function advancePlayoff(
  matchId: string,
  stage: PlayoffStage,
  order: number,
  sources: readonly (PlayoffBracketMatch | undefined)[],
  lookup: PlayoffScoreLookup,
  pick: "winner" | "loser",
): PlayoffBracketMatch {
  const ranked = sources
    .map((match) => (pick === "loser" ? playoffLoser(match) : playoffWinner(match)))
    .filter((athlete): athlete is PlayoffAdvanced => athlete !== null)
    .sort((left, right) => left.seed - right.seed || left.place - right.place || left.slotId.localeCompare(right.slotId));
  const higherSeed = ranked[0];
  const lowerSeed = ranked[1];
  if (!higherSeed) return blankPlayoffMatch(matchId, stage, order);
  const match: PlayoffBracketMatch = {
    matchId,
    stage,
    order,
    slotIdA: higherSeed.slotId,
    slotIdB: lowerSeed?.slotId ?? null,
    seedA: higherSeed.seed,
    seedB: lowerSeed?.seed ?? null,
    placeA: higherSeed.place,
    placeB: lowerSeed?.place ?? null,
    ...UNSCORED_LINES,
  };
  if (!lowerSeed) return match;
  return applyPlayoffScore(match, lookup(matchId, higherSeed.slotId, lowerSeed.slotId));
}

function playoffWinner(match: PlayoffBracketMatch | undefined): PlayoffAdvanced | null {
  if (!match?.winnerSlotId || match.slotIdA === null || match.slotIdB === null) return null;
  if (match.seedA === null || match.seedB === null || match.placeA === null || match.placeB === null) return null;
  if (match.winnerSlotId === match.slotIdA) return { slotId: match.slotIdA, seed: match.seedA, place: match.placeA };
  if (match.winnerSlotId === match.slotIdB) return { slotId: match.slotIdB, seed: match.seedB, place: match.placeB };
  return null;
}

function playoffLoser(match: PlayoffBracketMatch | undefined): PlayoffAdvanced | null {
  const winner = playoffWinner(match);
  if (!winner || !match?.slotIdA || !match.slotIdB) return null;
  if (match.seedA === null || match.seedB === null || match.placeA === null || match.placeB === null) return null;
  if (winner.slotId === match.slotIdA) return { slotId: match.slotIdB, seed: match.seedB, place: match.placeB };
  if (winner.slotId === match.slotIdB) return { slotId: match.slotIdA, seed: match.seedA, place: match.placeA };
  return null;
}

export interface PlayoffSideReport {
  id: string;
  tournamentId: string;
  timestamp: number;
  matchId: string;
  slotId: string;
  fish: number;
}

/**
 * Полный счёт пары, как при ручном подтверждении.
 * Ничья разбирается внутри projectPlayoff: доп. 5 минут, золотая рыба, затем рейтинг группы.
 */
export function withPlayoffDuel(
  events: readonly TournamentEvent[],
  duel: Extract<TournamentEvent, { type: "PLAYOFF_DUEL_SCORED" }>,
): readonly TournamentEvent[] {
  const next = events.filter((event) => !coversPlayoffMatch(event, duel.payload.matchId));
  return dropStalePlayoffScores([...next, duel]);
}

/**
 * Одна сторона пары. Вторая уже известная сторона сохраняется.
 * Когда известны обе, пишется PLAYOFF_DUEL_SCORED. QR несёт только основное время: уже введённый овертайм сохраняется.
 * Если пару записать нельзя, возвращается тот же массив.
 */
export function withPlayoffReport(
  events: readonly TournamentEvent[],
  report: PlayoffSideReport,
): readonly TournamentEvent[] {
  const projection = projectPlayoff(events);
  const match = playoffMatches(projection).find((item) => item.matchId === report.matchId);
  if (!match?.slotIdA || !match.slotIdB) return events;
  if (report.slotId !== match.slotIdA && report.slotId !== match.slotIdB) return events;

  const otherFish = report.slotId === match.slotIdA ? match.fishB : match.fishA;
  const withoutThisSide = events.filter((event) => !isSideReport(event, report.matchId, report.slotId));
  const fish = normalizeFish(report.fish);
  const drafted: TournamentEvent[] =
    otherFish === null
      ? [
          ...withoutThisSide,
          {
            id: report.id,
            tournamentId: report.tournamentId,
            type: "PLAYOFF_SIDE_REPORTED",
            timestamp: report.timestamp,
            payload: { matchId: report.matchId, slotId: report.slotId, fish },
          },
        ]
      : [
          ...withoutThisSide.filter((event) => !coversPlayoffMatch(event, report.matchId)),
          {
            id: report.id,
            tournamentId: report.tournamentId,
            type: "PLAYOFF_DUEL_SCORED",
            timestamp: report.timestamp,
            payload: {
              matchId: report.matchId,
              slotIdA: match.slotIdA,
              slotIdB: match.slotIdB,
              fishA: report.slotId === match.slotIdA ? fish : otherFish,
              fishB: report.slotId === match.slotIdB ? fish : otherFish,
              extraFishA: match.extraFishA ?? 0,
              extraFishB: match.extraFishB ?? 0,
              goldenFishA: match.goldenFishA ?? 0,
              goldenFishB: match.goldenFishB ?? 0,
              goldenFirst: match.goldenFirst,
            },
          },
        ];
  return dropStalePlayoffScores(drafted);
}

function coversPlayoffMatch(event: TournamentEvent, matchId: string): boolean {
  return (
    (event.type === "PLAYOFF_DUEL_SCORED" || event.type === "PLAYOFF_SIDE_REPORTED") && event.payload.matchId === matchId
  );
}

function isSideReport(event: TournamentEvent, matchId: string, slotId: string): boolean {
  return event.type === "PLAYOFF_SIDE_REPORTED" && event.payload.matchId === matchId && event.payload.slotId === slotId;
}

function dropStalePlayoffScores(events: readonly TournamentEvent[]): readonly TournamentEvent[] {
  const projection = projectPlayoff(events);
  if (!projection.formed) return events;
  const live = new Map(
    playoffMatches(projection)
      .filter((match) => match.slotIdA && match.slotIdB)
      .map((match) => [match.matchId, { slotIdA: match.slotIdA, slotIdB: match.slotIdB }]),
  );
  return events.filter((event) => {
    if (event.type === "PLAYOFF_DUEL_SCORED") {
      const pair = live.get(event.payload.matchId);
      return pair?.slotIdA === event.payload.slotIdA && pair.slotIdB === event.payload.slotIdB;
    }
    if (event.type === "PLAYOFF_SIDE_REPORTED") {
      const pair = live.get(event.payload.matchId);
      return event.payload.slotId === pair?.slotIdA || event.payload.slotId === pair?.slotIdB;
    }
    return true;
  });
}

function isUnsigned(state: TournamentState, slotId: string, round: RoundIndex, period: PeriodIndex): boolean {
  const protocols = state.protocols.get(`${round}:${period}`) ?? [];
  return protocols.some((protocol) => !protocol.signed && (protocol.slotIdA === slotId || protocol.slotIdB === slotId));
}

function sidePoints(points: DuelPoints, side: "a" | "b"): PeriodPoints {
  if (points.outcome === "blank") return 0;
  if (points.outcome === "draw") return 2;
  const isWinner = points.winner === side;
  return isWinner ? 4 : points.loserPoints;
}

function scoredAthlete(state: TournamentState, slotId: string, fish: FishCount, points: PeriodPoints): ScoredAthlete {
  return {
    slotId,
    bibNumber: state.slots.get(slotId)?.bibNumber ?? 0,
    fish,
    points,
  };
}

function gridSlot(state: TournamentState, duel: MatrixDuel, slotId: string, opponentSlotId: string | null): GridSlot {
  const side: Side =
    duel.kind === "pair"
      ? slotId === duel.leftSlotId
        ? "left"
        : "right"
      : matrixBank(state, slotId, duel.round, duel.period);
  return {
    round: duel.round,
    period: duel.period,
    groupId: duel.groupId,
    zoneId: duel.zoneId,
    sectorId: duel.sectorId,
    slotId,
    bibNumber: state.slots.get(slotId)?.bibNumber ?? 0,
    side,
    opponentSlotId,
  };
}

function resolveNeighborId(loneId: string, neighbor: LoneNeighborInput): string {
  if (neighbor.mode === "manual") {
    if (!neighbor.neighborId) throw new Error("Не передан ID соседа");
    return neighbor.neighborId;
  }
  if (neighbor.sectors.length === 0) throw new Error("Секторы для выбора соседа не заданы");
  const neighborId = neighbor.resolve(loneId, neighbor.sectors);
  if (!neighborId) throw new Error("Резолвер соседа не вернул ID");
  return neighborId;
}

function resolveLonePeriod(
  state: TournamentState,
  loneId: string,
  neighbor: LoneNeighborInput,
): { round: RoundIndex; period: PeriodIndex } {
  if (neighbor.mode === "sectors") {
    const sector = neighbor.sectors.find((item) => item.slotIds.includes(loneId)) ?? neighbor.sectors[0];
    if (sector) return { round: sector.round, period: sector.period };
  }

  const loneAssignments = assignmentsOf(state)
    .filter((assignment) => assignment.kind === "lone" && assignment.loneSlotId === loneId)
    .sort((left, right) => left.round - right.round || left.period - right.period);
  const latest = loneAssignments.at(-1);
  if (latest) return { round: latest.round, period: latest.period };

  return { round: 1, period: 1 };
}

function transitionViolation(state: TournamentState, neighborId: string, round: RoundIndex, period: PeriodIndex): boolean {
  const relevant = state.transitions.filter((item) => item.round === round && item.period === period);
  const byNeighbor = [...relevant].reverse().find((item) => item.requestedBySlotId === neighborId);
  if (byNeighbor) return byNeighbor.requested;

  return relevant.some(
    (item) => item.requested && item.requestedBySlotId === null && neighborInSector(state, neighborId, item.sectorId, round, period),
  );
}

function neighborInSector(
  state: TournamentState,
  neighborId: string,
  sectorId: string,
  round: RoundIndex,
  period: PeriodIndex,
): boolean {
  return assignmentsOf(state).some((assignment) => {
    if (assignment.round !== round || assignment.period !== period || assignment.sectorId !== sectorId) return false;
    if (assignment.kind === "pair") return assignment.slotIdA === neighborId || assignment.slotIdB === neighborId;
    return assignment.loneSlotId === neighborId || assignment.neighborSlotId === neighborId;
  });
}

function ensureSlot(state: TournamentState, slotId: string): void {
  if (state.slots.has(slotId)) return;
  state.slots.set(slotId, { slotId, bibNumber: 0, groupId: "A", displayName: slotId, ghost: false });
}

function normalizeFish(value: FishCount): FishCount {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function assignmentKey(round: RoundIndex, period: PeriodIndex, slotId: string): string {
  return `${round}:${period}:${slotId}`;
}

function comparisonKey(round: RoundIndex, period: PeriodIndex, loneSlotId: string): string {
  return `${round}:${period}:${loneSlotId}`;
}

function fishKey(slotId: string, round: RoundIndex, period: PeriodIndex): string {
  return `${slotId}:${round}:${period}`;
}

function compareDuels(left: DuelResult, right: DuelResult): number {
  return left.round - right.round || left.period - right.period || (left.sectorId ?? "").localeCompare(right.sectorId ?? "");
}

function compareGridSlots(left: GridSlot, right: GridSlot): number {
  return (
    left.round - right.round ||
    left.period - right.period ||
    left.sectorId.localeCompare(right.sectorId, undefined, { numeric: true }) ||
    left.bibNumber - right.bibNumber
  );
}

function uniqueIds(participantIds: readonly string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of participantIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

interface PairMemory {
  period: PeriodIndex;
  sector: number;
  leftId: string;
  rightId: string;
}

interface BankLedger {
  last: Side | null;
  left: number;
  right: number;
  streak: number;
}

interface FieldMeet {
  leftId: string;
  rightId: string;
  rematchSectors: ReadonlySet<number>;
}

function bestFieldMatching(
  field: readonly string[],
  bibOf: ReadonlyMap<string, number>,
  meetings: ReadonlyMap<string, readonly PairMemory[]>,
  byeCount: ReadonlyMap<string, number>,
  banks: ReadonlyMap<string, BankLedger>,
  lastSector: ReadonlyMap<string, number>,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
  seed: number,
  period: PeriodIndex,
  crossOnly: boolean,
): Array<[string, string]> {
  const ordered = [...field].sort(
    (left, right) => (bibOf.get(left) ?? 0) - (bibOf.get(right) ?? 0) || left.localeCompare(right),
  );
  const oddCount = ordered.filter((id) => id !== GHOST_ID && Math.abs(bibOf.get(id) ?? 0) % 2 === 1).length;
  const evenCount = ordered.filter((id) => id !== GHOST_ID && Math.abs(bibOf.get(id) ?? 0) % 2 === 0).length;
  let bestCost = Number.POSITIVE_INFINITY;
  let best: Array<[string, string]> = [];
  const current: Array<[string, string]> = [];

  const edgeCost = (leftId: string, rightId: string): number => {
    const prior = meetings.get(pairKey(leftId, rightId)) ?? [];
    let cost = prior.length * 1_000_000;
    if (prior.length > 0 && prior[prior.length - 1]?.period === period - 1) cost += 100_000;
    if (leftId === GHOST_ID || rightId === GHOST_ID) {
      const realId = leftId === GHOST_ID ? rightId : leftId;
      cost += (byeCount.get(realId) ?? 0) * 10_000;
      if (period === 1) {
        const realOdd = Math.abs(bibOf.get(realId) ?? 0) % 2 === 1;
        if (oddCount > evenCount && !realOdd) cost += 50_000;
        if (evenCount > oddCount && realOdd) cost += 50_000;
      }
    } else if (period === 1 && sameParity(leftId, rightId, bibOf)) {
      cost += 1_000_000_000;
    }
    if (leftId !== GHOST_ID && rightId !== GHOST_ID && wantedBank(banks.get(leftId), bibOf.get(leftId) ?? 0) === wantedBank(banks.get(rightId), bibOf.get(rightId) ?? 0)) {
      cost += 400 + bankPressure(banks.get(leftId)) + bankPressure(banks.get(rightId));
    }
    if (leftId !== GHOST_ID && rightId !== GHOST_ID) {
      const open = openSideSectors(leftId, rightId, ordered.length / 2, lastSector, sectorSides);
      if (open === 0) cost += 3_000;
      else if (open === 1) cost += 200;
    }
    return cost + (mixRank(seed, bibOf.get(leftId) ?? 0, bibOf.get(rightId) ?? 0, period) % 100);
  };

  const visit = (remaining: readonly string[], cost: number): void => {
    if (cost >= bestCost) return;
    const anchor = remaining[0];
    if (!anchor) {
      bestCost = cost;
      best = current.map((pair) => [pair[0], pair[1]]);
      return;
    }
    const partners = remaining.slice(1).sort(
      (left, right) => edgeCost(anchor, left) - edgeCost(anchor, right) || (bibOf.get(left) ?? 0) - (bibOf.get(right) ?? 0),
    );
    for (const partner of partners) {
      if (crossOnly && !crossOrBye(anchor, partner, bibOf)) continue;
      current.push([anchor, partner]);
      visit(
        remaining.filter((id) => id !== anchor && id !== partner),
        cost + edgeCost(anchor, partner),
      );
      current.pop();
    }
  };

  if (ordered.length > 12) return greedyFieldMatching(ordered, bibOf, edgeCost, crossOnly);
  visit(ordered, 0);
  return best;
}

function greedyFieldMatching(
  ordered: readonly string[],
  bibOf: ReadonlyMap<string, number>,
  edgeCost: (leftId: string, rightId: string) => number,
  crossOnly: boolean,
): Array<[string, string]> {
  const remaining = new Set(ordered);
  const pairs: Array<[string, string]> = [];
  const constrained = [...ordered].sort((left, right) => {
    const leftOptions = ordered.filter((id) => id !== left && (!crossOnly || crossOrBye(left, id, bibOf))).length;
    const rightOptions = ordered.filter((id) => id !== right && (!crossOnly || crossOrBye(right, id, bibOf))).length;
    return leftOptions - rightOptions || (bibOf.get(left) ?? 0) - (bibOf.get(right) ?? 0);
  });
  for (const anchor of constrained) {
    if (!remaining.has(anchor)) continue;
    let partner = "";
    let cheapest = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      if (candidate === anchor) continue;
      if (crossOnly && !crossOrBye(anchor, candidate, bibOf)) continue;
      const cost = edgeCost(anchor, candidate);
      if (cost < cheapest || (cost === cheapest && (bibOf.get(candidate) ?? 0) < (bibOf.get(partner) ?? 0))) {
        cheapest = cost;
        partner = candidate;
      }
    }
    if (!partner) return [];
    pairs.push([anchor, partner]);
    remaining.delete(anchor);
    remaining.delete(partner);
  }
  return pairs;
}

function assignMeetSectors(
  meets: readonly FieldMeet[],
  bibOf: ReadonlyMap<string, number>,
  sectorVisits: ReadonlyMap<string, readonly number[]>,
  lastSector: ReadonlyMap<string, number>,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
  banks: ReadonlyMap<string, BankLedger>,
  seed: number,
  period: PeriodIndex,
): number[] {
  const sectorCount = meets.length;
  if (sectorCount === 0) return [];
  const attempts: Array<[boolean, boolean]> = [
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ];
  for (const [blockRematchSector, blockConsecutiveSector] of attempts) {
    const placed = placeSectors(
      meets,
      bibOf,
      sectorVisits,
      lastSector,
      sectorSides,
      banks,
      seed,
      period,
      blockRematchSector,
      blockConsecutiveSector,
    );
    if (placed) return placed;
  }
  return meets.map((_, index) => index);
}

function placeSectors(
  meets: readonly FieldMeet[],
  bibOf: ReadonlyMap<string, number>,
  sectorVisits: ReadonlyMap<string, readonly number[]>,
  lastSector: ReadonlyMap<string, number>,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
  banks: ReadonlyMap<string, BankLedger>,
  seed: number,
  period: PeriodIndex,
  blockRematchSector: boolean,
  blockConsecutiveSector: boolean,
): number[] | null {
  const sectorCount = meets.length;
  let bestCost = Number.POSITIVE_INFINITY;
  let best: number[] | null = null;
  const used = new Array<boolean>(sectorCount).fill(false);
  const current = new Array<number>(sectorCount).fill(-1);

  const sectorCost = (meet: FieldMeet, sector: number): number => {
    const anglers = [meet.leftId, meet.rightId].filter((id) => id !== GHOST_ID);
    let cost = anglers.reduce((sum, id) => sum + repeatWeight(visitCount(sectorVisits, id, sector)), 0);
    cost += anglers.reduce((sum, id) => sum + returnSidePenalty(id, sector, sectorSides, banks, bibOf), 0);
    if (anglers.some((id) => lastSector.get(id) === sector)) cost += 50_000;
    if (meet.rematchSectors.has(sector)) cost += 5_000;
    if (sectorSideClash(meet, sector, sectorSides)) cost += 800;
    cost += forcedStreakCost(meet, sector, sectorSides, banks);
    return cost + (mixRank(seed, bibOf.get(meet.leftId) ?? 0, bibOf.get(meet.rightId) ?? 0, sector, period) % 17);
  };

  const visit = (index: number, cost: number): void => {
    if (cost >= bestCost) return;
    if (index === meets.length) {
      bestCost = cost;
      best = [...current];
      return;
    }
    const meet = meets[index];
    if (!meet) return;
    const order = Array.from({ length: sectorCount }, (_, sector) => sector).sort(
      (left, right) => sectorCost(meet, left) - sectorCost(meet, right),
    );
    for (const sector of order) {
      if (used[sector]) continue;
      if (blockConsecutiveSector && consecutiveSector(meet, sector, lastSector)) continue;
      if (blockRematchSector && meet.rematchSectors.has(sector) && sectorCount > meet.rematchSectors.size) continue;
      used[sector] = true;
      current[index] = sector;
      visit(index + 1, cost + sectorCost(meet, sector));
      used[sector] = false;
    }
  };

  if (sectorCount > 8) return greedySectors(meets, sectorCost, blockRematchSector, blockConsecutiveSector, lastSector);
  visit(0, 0);
  return best;
}

function greedySectors(
  meets: readonly FieldMeet[],
  sectorCost: (meet: FieldMeet, sector: number) => number,
  blockRematchSector: boolean,
  blockConsecutiveSector: boolean,
  lastSector: ReadonlyMap<string, number>,
): number[] | null {
  const sectorCount = meets.length;
  const used = new Array<boolean>(sectorCount).fill(false);
  const placed = new Array<number>(sectorCount).fill(-1);
  const order = meets
    .map((meet, index) => ({ meet, index }))
    .sort((left, right) => right.meet.rematchSectors.size - left.meet.rematchSectors.size);
  for (const item of order) {
    let chosen = -1;
    let cheapest = Number.POSITIVE_INFINITY;
    for (let sector = 0; sector < sectorCount; sector += 1) {
      if (used[sector]) continue;
      if (blockConsecutiveSector && consecutiveSector(item.meet, sector, lastSector)) continue;
      if (blockRematchSector && item.meet.rematchSectors.has(sector) && sectorCount > item.meet.rematchSectors.size) continue;
      const cost = sectorCost(item.meet, sector);
      if (cost < cheapest) {
        cheapest = cost;
        chosen = sector;
      }
    }
    if (chosen < 0) return null;
    used[chosen] = true;
    placed[item.index] = chosen;
  }
  return placed;
}

function orientPair(
  leftId: string,
  rightId: string,
  memory: readonly PairMemory[],
  bibOf: ReadonlyMap<string, number>,
  banks: ReadonlyMap<string, BankLedger>,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
  sector: number,
  seed: number,
  period: PeriodIndex,
): { leftId: string; rightId: string } {
  const last = memory[memory.length - 1];
  const options = [
    { leftId, rightId },
    { leftId: rightId, rightId: leftId },
  ];
  const costOf = (option: { leftId: string; rightId: string }): number => {
    let cost = seatCost(option.leftId, "left", bibOf, banks) + seatCost(option.rightId, "right", bibOf, banks);
    cost += sectorSideCost(option.leftId, "left", sector, sectorSides);
    cost += sectorSideCost(option.rightId, "right", sector, sectorSides);
    if (last && option.leftId === last.rightId && option.rightId === last.leftId) cost -= 5;
    return cost + (mixRank(seed, bibOf.get(option.leftId) ?? 0, bibOf.get(option.rightId) ?? 0, period) % 7);
  };
  options.sort((left, right) => costOf(left) - costOf(right));
  return options[0] ?? { leftId, rightId };
}

function seatCost(slotId: string, side: Side, bibOf: ReadonlyMap<string, number>, banks: ReadonlyMap<string, BankLedger>): number {
  const ledger = banks.get(slotId);
  if (side === wantedBank(ledger, bibOf.get(slotId) ?? 0)) return 0;
  const streak = ledger?.streak ?? 0;
  const left = ledger?.left ?? 0;
  const right = ledger?.right ?? 0;
  const surplus = side === "left" ? left - right : right - left;
  return 100 + streak * 50 + Math.max(0, surplus) * 20;
}

function wantedBank(ledger: BankLedger | undefined, bibNumber: number): Side {
  if (!ledger?.last) return Math.abs(bibNumber) % 2 === 1 ? "left" : "right";
  return ledger.last === "left" ? "right" : "left";
}

function preferredBank(ledger: BankLedger | undefined, bibNumber: number): Side {
  return wantedBank(ledger, bibNumber);
}

function bankPressure(ledger: BankLedger | undefined): number {
  return (ledger?.streak ?? 0) * 10;
}

function rememberBank(banks: Map<string, BankLedger>, slotId: string, side: Side): void {
  const ledger = banks.get(slotId) ?? { last: null, left: 0, right: 0, streak: 0 };
  ledger.streak = ledger.last === side ? ledger.streak + 1 : 1;
  if (side === "left") ledger.left += 1;
  else ledger.right += 1;
  ledger.last = side;
  banks.set(slotId, ledger);
}

function matrixBank(state: TournamentState, slotId: string, round: RoundIndex, period: PeriodIndex): Side {
  const bib = state.slots.get(slotId)?.bibNumber ?? 0;
  let side: Side = Math.abs(bib) % 2 === 1 ? "left" : "right";
  const sectorSide = new Map<string, Side>();
  for (let current = 1; current <= period; current += 1) {
    const duel = state.matrix.find((item) => {
      if (item.round !== round || item.period !== current) return false;
      if (item.kind === "pair") return item.leftSlotId === slotId || item.rightSlotId === slotId;
      return item.loneSlotId === slotId;
    });
    if (!duel) continue;
    if (duel.kind === "pair") side = duel.leftSlotId === slotId ? "left" : "right";
    else if (current > 1) {
      const previous = sectorSide.get(duel.sectorId);
      side = previous ? oppositeSide(previous) : oppositeSide(side);
    }
    sectorSide.set(duel.sectorId, side);
  }
  return side;
}

function repeatWeight(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 100;
  if (count === 2) return 280;
  return 2_000 + count * 100;
}

function returnSidePenalty(
  slotId: string,
  sector: number,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
  banks: ReadonlyMap<string, BankLedger>,
  bibOf: ReadonlyMap<string, number>,
): number {
  const previous = sectorSides.get(slotId)?.get(sector);
  if (!previous) return 0;
  const required = oppositeSide(previous);
  const wanted = wantedBank(banks.get(slotId), bibOf.get(slotId) ?? 0);
  return required === wanted ? 0 : 70;
}

function openSideSectors(
  leftId: string,
  rightId: string,
  sectorCount: number,
  lastSector: ReadonlyMap<string, number>,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
): number {
  let open = 0;
  for (let sector = 0; sector < sectorCount; sector += 1) {
    if (lastSector.get(leftId) === sector || lastSector.get(rightId) === sector) continue;
    const left = sectorSides.get(leftId)?.get(sector);
    const right = sectorSides.get(rightId)?.get(sector);
    if (left && right && left === right) continue;
    open += 1;
  }
  return open;
}

function forcedStreakCost(
  meet: FieldMeet,
  sector: number,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
  banks: ReadonlyMap<string, BankLedger>,
): number {
  const anglers = [meet.leftId, meet.rightId].filter((id) => id !== GHOST_ID);
  if (anglers.length < 2) return 0;
  const required = anglers.map((id) => {
    const previous = sectorSides.get(id)?.get(sector);
    return previous ? oppositeSide(previous) : null;
  });
  const [firstSide, secondSide] = required;
  const [firstId, secondId] = anglers;
  if (!firstId || !secondId) return 0;
  if (firstSide && secondSide) {
    if (firstSide === secondSide) return 0;
    return streakExtension(firstId, firstSide, banks) + streakExtension(secondId, secondSide, banks);
  }
  if (firstSide) return streakExtension(secondId, oppositeSide(firstSide), banks);
  if (secondSide) return streakExtension(firstId, oppositeSide(secondSide), banks);
  return 0;
}

function streakExtension(slotId: string, side: Side, banks: ReadonlyMap<string, BankLedger>): number {
  const ledger = banks.get(slotId);
  if (!ledger?.last || ledger.last !== side) return 0;
  if (ledger.streak >= 3) return 1_200;
  if (ledger.streak === 2) return 450;
  return 0;
}

function sectorSideClash(meet: FieldMeet, sector: number, sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>): boolean {
  const left = sectorSides.get(meet.leftId)?.get(sector);
  const right = sectorSides.get(meet.rightId)?.get(sector);
  return left !== undefined && right !== undefined && left === right;
}

function consecutiveSector(meet: FieldMeet, sector: number, lastSector: ReadonlyMap<string, number>): boolean {
  return [meet.leftId, meet.rightId].some((id) => id !== GHOST_ID && lastSector.get(id) === sector);
}

function sectorBank(slotId: string, sector: number, sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>): Side | null {
  const previous = sectorSides.get(slotId)?.get(sector);
  return previous ? oppositeSide(previous) : null;
}

function sectorSideCost(
  slotId: string,
  side: Side,
  sector: number,
  sectorSides: ReadonlyMap<string, ReadonlyMap<number, Side>>,
): number {
  const previous = sectorSides.get(slotId)?.get(sector);
  return previous && previous === side ? 2_000 : 0;
}

function oppositeSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

function rememberSectorSide(sectorSides: Map<string, Map<number, Side>>, slotId: string, sector: number, side: Side): void {
  const visits = sectorSides.get(slotId) ?? new Map<number, Side>();
  visits.set(sector, side);
  sectorSides.set(slotId, visits);
}

function rememberSector(
  sectorVisits: Map<string, number[]>,
  lastSector: Map<string, number>,
  slotId: string,
  sector: number,
): void {
  const visits = sectorVisits.get(slotId) ?? [];
  visits.push(sector);
  sectorVisits.set(slotId, visits);
  lastSector.set(slotId, sector);
}

function visitCount(sectorVisits: ReadonlyMap<string, readonly number[]>, slotId: string, sector: number): number {
  return (sectorVisits.get(slotId) ?? []).filter((item) => item === sector).length;
}

function crossOrBye(leftId: string, rightId: string, bibOf: ReadonlyMap<string, number>): boolean {
  if (leftId === GHOST_ID || rightId === GHOST_ID) return true;
  return !sameParity(leftId, rightId, bibOf);
}

function sameParity(leftId: string, rightId: string, bibOf: ReadonlyMap<string, number>): boolean {
  return Math.abs(bibOf.get(leftId) ?? 0) % 2 === Math.abs(bibOf.get(rightId) ?? 0) % 2;
}

function pairKey(leftId: string, rightId: string): string {
  return leftId < rightId ? `${leftId}\0${rightId}` : `${rightId}\0${leftId}`;
}

function mixSeed(parts: readonly (number | string)[]): number {
  let seed = 0x9e3779b9;
  for (const part of parts) {
    if (typeof part === "number") {
      seed = Math.imul(seed ^ (part | 0), 0x85ebca6b);
      continue;
    }
    for (let index = 0; index < part.length; index += 1) {
      seed = Math.imul(seed ^ part.charCodeAt(index), 0x85ebca6b);
    }
  }
  return seed >>> 0;
}

function mixRank(seed: number, ...parts: number[]): number {
  let value = seed >>> 0;
  for (const part of parts) value = Math.imul(value ^ part, 0x45d9f3b);
  return value >>> 0;
}

function gridPlace(
  slotId: string,
  opponentSlotId: string | null,
  side: Side,
  period: PeriodIndex,
  sectorId: string,
  bibOf: ReadonlyMap<string, number>,
): GridSlot {
  return {
    round: 1,
    period,
    groupId: "A",
    zoneId: "blue",
    sectorId,
    slotId,
    bibNumber: bibOf.get(slotId) ?? 0,
    side,
    opponentSlotId,
  };
}
