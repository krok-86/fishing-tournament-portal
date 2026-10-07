import { type DuelPoints, type DuelResult, type FishCount, type GridSlot, type LeaderboardEntry, type LoneNeighborInput, type PlayoffBracketMatch, type PlayoffDecision, type PlayoffPairing, type PlayoffProjection, type PlayoffSeed, type TournamentCalculator, type TournamentEvent, type VirtualDuelResult } from "./types.js";
/**
 * Очки одного спортсмена:
 * 0 рыб → 0; больше соперника → 4; поровну и оба поймали → 2; меньше, но рыба есть → 1.
 */
export declare function scoreDuel(fishA: FishCount, fishB: FishCount): DuelPoints;
/**
 * Плей-офф не знает ничьей.
 * Больше поимок — победа. Поровну, включая 0:0 и 2:2, — побеждает более высокое место отбора.
 * Одинаковое место отбора разводит меньший seed: это порядок строк таблицы.
 */
export declare function scorePlayoffDuel(fishA: FishCount, fishB: FishCount, placeA: number, seedA: number, placeB: number, seedB: number): PlayoffDecision;
export declare function calculateDuels(events: readonly TournamentEvent[]): DuelResult[];
export declare function generateLeaderboard(events: readonly TournamentEvent[]): LeaderboardEntry[];
/**
 * Сетка переходов.
 * Нечётный номер меняет борт каждый период, начиная слева. Чётный — начиная справа.
 * Сектор тоже меняется каждый период. Повтор пары при 9 участниках на 8 периодах
 * бывает не больше одного раза и не в соседних турах.
 * Нечётный список: один спортсмен периода сидит без соперника, его борт входит в баланс.
 */
export declare function generateTournamentGrid(participantIds: string[], periodsCount: number): GridSlot[];
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
