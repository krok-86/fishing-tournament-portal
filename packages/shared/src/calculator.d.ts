import { type DuelPoints, type DuelResult, type FishCount, type GridSlot, type LeaderboardEntry, type LoneNeighborInput, type PeriodIndex, type PeriodPoints, type PlayoffBracketMatch, type PlayoffDecision, type PlayoffDuelInput, type PlayoffPairing, type PlayoffProjection, type PlayoffSeed, type RoundIndex, type Side, type TournamentCalculator, type TournamentEvent, type VirtualDuelResult } from "./types.js";
/**
 * Очки одного спортсмена:
 * 0 рыб → 0; больше соперника → 4; поровну и оба поймали → 2; меньше, но рыба есть → 1.
 */
export declare function scoreDuel(fishA: FishCount, fishB: FishCount): DuelPoints;
/** Очки спортсмена против соперника. 4 победа, 2 ничья, 1 поражение с рыбой, 0 ноль поимок. */
export declare function pointsAgainst(ownFish: FishCount, opponentFish: FishCount): PeriodPoints;
/**
 * Кубковая дуэль PAL Trout 2026.
 * 1. Больше рыб в основное время.
 * 2. Ничья основного времени — доп. 5 минут.
 * 3. Ничья доп. времени — «Золотая рыба»: больше рыб, либо кто поймал первым при равном ненулевом счёте.
 * 4. Только 0:0 в золотой рыбе отдаёт победу более высокому месту группы (меньший place, затем меньший seed).
 */
export declare function scorePlayoffDuel(input: PlayoffDuelInput): PlayoffDecision;
export declare function calculateDuels(events: readonly TournamentEvent[]): DuelResult[];
export declare function generateLeaderboard(events: readonly TournamentEvent[]): LeaderboardEntry[];
/** Виртуальный соперник нечётного состава. В сетку слотом не сажается: живой в этом туре один. */
export declare const GHOST_ID = "GHOST";
export declare function isGhostOpponent(slotId: string | null | undefined): boolean;
/**
 * Стартовый борт и чередование, если других сведений нет.
 * Период 1: нечётный номер слева, чётный справа. Дальше борт меняется каждый период.
 * В сетке борт пары и одиночки берётся из их собственной истории, а не только из этой формулы.
 */
export declare function bankSide(bibNumber: number, periodNumber: number): Side;
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
export declare function comparisonNeighborId(seats: readonly SectorMapSeat[], loneSlotId: string): string | null;
/** Сосед одиночки из уже построенной сетки. Борт берётся из слота жеребьёвки. */
export declare function comparisonNeighborFromGrid(grid: readonly GridSlot[], loneSlotId: string, period: PeriodIndex, round?: RoundIndex, skipSlotIds?: ReadonlySet<string>): string | null;
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
export declare function previewPlayoffScore(projection: PlayoffProjection, matchId: string, lines: PlayoffDraftLines): PlayoffProjection;
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
 * Ничья разбирается внутри projectPlayoff: доп. 5 минут, золотая рыба, затем рейтинг группы.
 */
export declare function withPlayoffDuel(events: readonly TournamentEvent[], duel: Extract<TournamentEvent, {
    type: "PLAYOFF_DUEL_SCORED";
}>): readonly TournamentEvent[];
/**
 * Одна сторона пары. Вторая уже известная сторона сохраняется.
 * Когда известны обе, пишется PLAYOFF_DUEL_SCORED. QR несёт только основное время: уже введённый овертайм сохраняется.
 * Если пару записать нельзя, возвращается тот же массив.
 */
export declare function withPlayoffReport(events: readonly TournamentEvent[], report: PlayoffSideReport): readonly TournamentEvent[];
