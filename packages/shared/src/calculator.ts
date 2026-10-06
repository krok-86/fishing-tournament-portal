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

/**
 * Плей-офф не знает ничьей.
 * Больше поимок — победа. Поровну, включая 0:0 и 2:2, — побеждает более высокое место отбора.
 * Одинаковое место отбора разводит меньший seed: это порядок строк таблицы.
 */
export function scorePlayoffDuel(
  fishA: FishCount,
  fishB: FishCount,
  placeA: number,
  seedA: number,
  placeB: number,
  seedB: number,
): PlayoffDecision {
  const left = normalizeFish(fishA);
  const right = normalizeFish(fishB);
  if (left !== right) {
    return { winner: left > right ? "a" : "b", fishA: left, fishB: right, decidedBy: "catches" };
  }
  return {
    winner: betterQualifier(placeA, seedA, placeB, seedB),
    fishA: left,
    fishB: right,
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

/**
 * Матрица переходов кругом Бергера.
 * Порядок `participantIds` — порядок регистрации: номер 1, 2, 3…
 * Период 1: пары 1–2, 3–4, 5–6…
 * Дальше список крутится, один участник закреплён, остальные сдвигаются.
 * В первых турах пары не повторяются. Если периодов больше, чем уникальных туров,
 * круг начинается сначала — повторы только в хвосте.
 * Сектор пары: 1, 2, 3… и сдвигается каждый период. Меньший номер стоит слева.
 * Нечётный список получает пропуск: в этом периоде у спортсмена нет соперника.
 */
export function generateTournamentGrid(participantIds: string[], periodsCount: number): GridSlot[] {
  const ids = uniqueIds(participantIds);
  if (ids.length === 0 || !Number.isInteger(periodsCount) || periodsCount < 1) return [];

  const periods = Math.min(SCHEDULE_PERIODS.length, periodsCount);
  const bibOf = new Map(ids.map((id, index) => [id, index + 1]));
  const rounds = bergerRounds(ids);
  const slots: GridSlot[] = [];

  for (let periodNumber = 1; periodNumber <= periods; periodNumber += 1) {
    const period = SCHEDULE_PERIODS[periodNumber - 1] ?? 1;
    const pairs = rounds[(periodNumber - 1) % rounds.length] ?? [];
    const sectorCount = pairs.length;
    pairs.forEach((pair, pairIndex) => {
      const sectorId = String(((pairIndex + periodNumber - 1) % sectorCount) + 1);
      const [first, second] = orderPair(pair, bibOf);
      if (!first) return;
      if (!second) {
        slots.push(gridPlace(first, null, "left", period, sectorId, bibOf));
        return;
      }
      slots.push(gridPlace(first, second, "left", period, sectorId, bibOf));
      slots.push(gridPlace(second, first, "right", period, sectorId, bibOf));
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
  if (!projection.formed || !projection.final) return [];
  return [...projection.quarterfinals, ...projection.semifinals, projection.final];
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
      scores.set(event.payload.matchId, {
        matchId: event.payload.matchId,
        slotIdA: event.payload.slotIdA,
        slotIdB: event.payload.slotIdB,
        fishA: event.payload.fishA,
        fishB: event.payload.fishB,
      });
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

/**
 * Черновик поимок поверх уже собранной сетки.
 * Победитель и следующий раунд считаются тем же тай-брейком, что и при записи дуэли.
 * Счёт следующего раунда сохраняется, только если в паре остались те же спортсмены.
 */
export function previewPlayoffScore(
  projection: PlayoffProjection,
  matchId: string,
  fishA: FishCount,
  fishB: FishCount,
): PlayoffProjection {
  if (!projection.formed || !projection.final) return projection;
  const pairings = projection.quarterfinals.map(matchToPairing);
  if (pairings.some((pairing) => pairing === null)) return projection;
  const target = playoffMatches(projection).find((match) => match.matchId === matchId);
  if (!target?.slotIdA || !target.slotIdB) return projection;

  const scores = scoresFromProjection(projection);
  scores.set(matchId, {
    matchId,
    slotIdA: target.slotIdA,
    slotIdB: target.slotIdB,
    fishA,
    fishB,
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
 * Ближайший сосед одиночки в этом периоде: следующий или предыдущий сектор,
 * сначала сторона, которая смотрит в сторону одиночки.
 * Очки этой виртуальной дуэли соседу не начисляются.
 */
function nearestSectorNeighbor(
  matrix: readonly MatrixDuel[],
  round: RoundIndex,
  period: PeriodIndex,
  loneSlotId: string,
): string | null {
  const seats = new Map<string, { order: number; left: string | null; right: string | null }>();
  for (const duel of matrix) {
    if (duel.round !== round || duel.period !== period) continue;
    const parsed = Number(duel.sectorId);
    const seat = seats.get(duel.sectorId) ?? {
      order: Number.isFinite(parsed) ? parsed : 0,
      left: null,
      right: null,
    };
    if (duel.kind === "pair") {
      seat.left = duel.leftSlotId;
      seat.right = duel.rightSlotId;
    } else {
      seat.left = duel.loneSlotId;
    }
    seats.set(duel.sectorId, seat);
  }

  const ordered = [...seats.values()].sort((left, right) => left.order - right.order);
  const sectorIndex = ordered.findIndex((seat) => seat.left === loneSlotId || seat.right === loneSlotId);
  if (sectorIndex < 0) return null;

  const loneOnLeft = ordered[sectorIndex]?.left === loneSlotId;
  const nearestFirst = loneOnLeft ? [sectorIndex + 1, sectorIndex - 1] : [sectorIndex - 1, sectorIndex + 1];
  for (const index of nearestFirst) {
    const adjacent = ordered[index];
    if (!adjacent) continue;
    const towardLone = index > sectorIndex ? [adjacent.left, adjacent.right] : [adjacent.right, adjacent.left];
    for (const candidate of towardLone) {
      if (candidate && candidate !== loneSlotId) return candidate;
    }
  }
  return null;
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
        neighborSlotId: pinned ?? nearestSectorNeighbor(state.matrix, duel.round, duel.period, duel.loneSlotId),
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
    };
  });
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
    fishA: null,
    fishB: null,
    winnerSlotId: null,
    decidedBy: null,
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
    fishA: null,
    fishB: null,
    winnerSlotId: null,
    decidedBy: null,
  };
}

function applyPlayoffScore(match: PlayoffBracketMatch, score: PlayoffScore | undefined): PlayoffBracketMatch {
  if (!score || !match.slotIdA || !match.slotIdB) return match;
  if (score.slotIdA !== match.slotIdA || score.slotIdB !== match.slotIdB) return match;
  if (match.placeA === null || match.placeB === null || match.seedA === null || match.seedB === null) return match;
  if (score.fishA === null || score.fishB === null) {
    return {
      ...match,
      fishA: score.fishA,
      fishB: score.fishB,
      winnerSlotId: null,
      decidedBy: null,
    };
  }
  const decision = scorePlayoffDuel(score.fishA, score.fishB, match.placeA, match.seedA, match.placeB, match.seedB);
  return {
    ...match,
    fishA: decision.fishA,
    fishB: decision.fishB,
    winnerSlotId: decision.winner === "a" ? match.slotIdA : match.slotIdB,
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
    advancePlayoff(`sf-${order}`, "semifinal", order, [quarterfinals[sources[0]], quarterfinals[sources[1]]], lookup),
  );
  const finalMatch = advancePlayoff("final", "final", 0, [semifinals[0], semifinals[1]], lookup);
  return {
    formed: true,
    seeds,
    quarterfinals,
    semifinals,
    final: finalMatch,
  };
}

function scoresFromProjection(projection: PlayoffProjection): Map<string, PlayoffScore> {
  const scores = new Map<string, PlayoffScore>();
  if (!projection.final) return scores;
  for (const match of [...projection.quarterfinals, ...projection.semifinals, projection.final]) {
    if (!match.slotIdA || !match.slotIdB || (match.fishA === null && match.fishB === null)) continue;
    scores.set(match.matchId, {
      matchId: match.matchId,
      slotIdA: match.slotIdA,
      slotIdB: match.slotIdB,
      fishA: match.fishA,
      fishB: match.fishB,
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
): PlayoffBracketMatch {
  const ranked = sources
    .map(playoffWinner)
    .filter((winner): winner is PlayoffAdvanced => winner !== null)
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
    fishA: null,
    fishB: null,
    winnerSlotId: null,
    decidedBy: null,
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
 * Ничья разбирается внутри projectPlayoff: больше рыб или более высокое место отбора.
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
 * Когда известны обе, пишется PLAYOFF_DUEL_SCORED и победитель считается тем же тай-брейком.
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
  return {
    round: duel.round,
    period: duel.period,
    groupId: duel.groupId,
    zoneId: duel.zoneId,
    sectorId: duel.sectorId,
    slotId,
    bibNumber: state.slots.get(slotId)?.bibNumber ?? 0,
    side: opponentSlotId === null ? "left" : sideByBib(state, slotId, opponentSlotId),
    opponentSlotId,
  };
}

function sideByBib(state: TournamentState, slotId: string, opponentSlotId: string): Side {
  const bib = state.slots.get(slotId)?.bibNumber ?? 0;
  const opponentBib = state.slots.get(opponentSlotId)?.bibNumber ?? 0;
  if (bib === opponentBib) return slotId < opponentSlotId ? "left" : "right";
  return bib < opponentBib ? "left" : "right";
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

/** Один уникальный круг. `null` — пропуск при нечётном числе участников. */
function bergerRounds(ids: readonly string[]): Array<Array<[string, string | null]>> {
  const players: Array<string | null> = [...ids];
  if (players.length % 2 === 1) players.push(null);

  const count = players.length;
  const half = count / 2;
  const rotation: Array<string | null> = new Array(count);
  for (let pair = 0; pair < half; pair += 1) {
    rotation[pair] = players[pair * 2] ?? null;
    rotation[count - 1 - pair] = players[pair * 2 + 1] ?? null;
  }

  const rounds: Array<Array<[string, string | null]>> = [];
  for (let round = 0; round < count - 1; round += 1) {
    const pairs: Array<[string, string | null]> = [];
    for (let index = 0; index < half; index += 1) {
      const left = rotation[index] ?? null;
      const right = rotation[count - 1 - index] ?? null;
      if (left && right) pairs.push([left, right]);
      else if (left) pairs.push([left, null]);
      else if (right) pairs.push([right, null]);
    }
    rounds.push(pairs);

    const fixed = rotation[0] ?? null;
    const tail = rotation.slice(1);
    const moved = tail.length === 0 ? [] : [tail[tail.length - 1] ?? null, ...tail.slice(0, -1)];
    rotation.splice(0, rotation.length, fixed, ...moved);
  }

  return rounds.length > 0 ? rounds : [[]];
}

function orderPair(pair: readonly [string, string | null], bibOf: ReadonlyMap<string, number>): [string, string | null] {
  const [first, second] = pair;
  if (!second) return [first, null];
  return bibOf.get(first)! <= bibOf.get(second)! ? [first, second] : [second, first];
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
