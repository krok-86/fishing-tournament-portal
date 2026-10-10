import { type DuelPoints, type DuelResult, type FishCount, type GridSlot, type LeaderboardEntry, type LoneNeighborInput, type PeriodIndex, type PeriodPoints, type PlayoffBracketMatch, type PlayoffDecision, type PlayoffPairing, type PlayoffProjection, type PlayoffSeed, type RoundIndex, type Side, type TournamentCalculator, type TournamentEvent, type VirtualDuelResult } from "./types.js";
/**
 * Очки одного спортсмена:
 * 0 рыб → 0; больше соперника → 4; поровну и оба поймали → 2; меньше, но рыба есть → 1.
 */
export declare function scoreDuel(fishA: FishCount, fishB: FishCount): DuelPoints;
/** Очки спортсмена против соперника. 4 победа, 2 ничья, 1 поражение с рыбой, 0 ноль поимок. */
export declare function pointsAgainst(ownFish: FishCount, opponentFish: FishCount): PeriodPoints;
/**
 * Плей-офф не знает ничьей.
 * Больше поимок — победа. Поровну, включая 0:0 и 2:2, — побеждает более высокое место отбора.
 * Одинаковое место отбора разводит меньший seed: это порядок строк таблицы.
 */
export declare function scorePlayoffDuel(fishA: FishCount, fishB: FishCount, placeA: number, seedA: number, placeB: number, seedB: number): PlayoffDecision;
export declare function calculateDuels(events: readonly TournamentEvent[]): DuelResult[];
export declare function generateLeaderboard(events: readonly TournamentEvent[]): LeaderboardEntry[];
/** Виртуальный соперник нечётного состава. В сетку слотом не сажается. */
export declare const GHOST_ID: "GHOST";
export declare function isGhostOpponent(slotId: string | null | undefined): boolean;
/**
 * Стартовый борт, если история номера ещё неизвестна.
 * Период 1: нечётный слева, чётный справа. Дальше формула чередует борт.
 */
export declare function bankSide(bibNumber: number, periodNumber: number): Side;
export interface SectorMapSeat {
    sectorId: string;
    order: number;
    leftSlotId: string | null;
    rightSlotId: string | null;
}
/** Сосед одиночки: ближайший сектор в сторону пустого борта. */
export declare function comparisonNeighborId(seats: readonly SectorMapSeat[], loneSlotId: string): string | null;
/** Сосед одиночки по карте секторов. Борт берётся из слота жеребьёвки. */
export declare function comparisonNeighborFromGrid(grid: readonly GridSlot[], loneSlotId: string, period: PeriodIndex, round?: RoundIndex, skipSlotIds?: ReadonlySet<string>): string | null;
/**
 * Сетка отбора. Нечётный состав дополняется GHOST.
 * Период 1 — чётный с нечётным, пары перемешаны.
 * Дальше разрешены пары одной чётности. Повтор меняет борта и сектор.
 * Сектор не повторяется два периода подряд. Поздний возврат меняет борт относительно прошлого визита.
 * Одинаковые номера с разными id участников дают разные листы. Один список остаётся стабильным.
 */
export declare function generateTournamentGrid(participantIds: readonly string[], periodsCount: number, bibNumbers?: readonly number[]): GridSlot[];
export declare function readTransitionGrid(events: readonly TournamentEvent[]): GridSlot[];
export declare const emptyPlayoffProjection: PlayoffProjection;
/** Первые восемь строк таблицы. seed — порядок, place — место отбора. */
export declare function seedsFromRanking(entries: readonly LeaderboardEntry[]): PlayoffSeed[] | null;
/** 1vs8, 2vs7, 3vs6, 4vs5. На стороне A — более высокий посев. */
export declare function buildQuarterfinals(seeds: readonly PlayoffSeed[]): PlayoffPairing[] | null;
export declare function playoffMatches(projection: PlayoffProjection): PlayoffBracketMatch[];
/** Сетка кубка. Очки отбора не меняет: события плей-офф в таблицу не входят. */
export declare function projectPlayoff(events: readonly TournamentEvent[]): PlayoffProjection;
/**
 * Черновик поимок поверх уже собранной сетки.
 * Победитель и следующий раунд считаются тем же тай-брейком, что и при записи дуэли.
 * Счёт следующего раунда сохраняется, только если в паре остались те же спортсмены.
 */
export declare function previewPlayoffScore(projection: PlayoffProjection, matchId: string, fishA: FishCount, fishB: FishCount): PlayoffProjection;
export declare function calculateLoneResult(events: readonly TournamentEvent[], loneId: string, neighbor: LoneNeighborInput): VirtualDuelResult;
export declare const tournamentCalculator: TournamentCalculator;
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
export declare function withPlayoffDuel(events: readonly TournamentEvent[], duel: Extract<TournamentEvent, {
    type: "PLAYOFF_DUEL_SCORED";
}>): readonly TournamentEvent[];
/**
 * Одна сторона пары. Вторая уже известная сторона сохраняется.
 * Когда известны обе, пишется PLAYOFF_DUEL_SCORED и победитель считается тем же тай-брейком.
 * Если пару записать нельзя, возвращается тот же массив.
 */
export declare function withPlayoffReport(events: readonly TournamentEvent[], report: PlayoffSideReport): readonly TournamentEvent[];
