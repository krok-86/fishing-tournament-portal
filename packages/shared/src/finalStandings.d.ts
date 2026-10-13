import type { LeaderboardEntry, PlayoffProjection } from "./types.ts";
/** Дальше этой стадии спортсмен в кубке не прошёл. */
export type FinalStage = "Чемпион" | "Финалист" | "3-е место" | "4-е место" | "1/4 финала" | "Групповой этап";
export interface FinalStanding {
    place: number;
    slotId: string;
    bibNumber: number;
    displayName: string;
    /** Свои поимки за восемь периодов отбора, без кубка. */
    qualifyingFish: number;
    stage: FinalStage;
}
interface StandingPerson {
    slotId: string;
    bibNumber: number;
    displayName: string;
    ghost?: boolean;
}
/**
 * Итог турнира: 1 чемпион, 2 финалист, 3 и 4 — матч за бронзу,
 * 5–8 — проигравшие четвертьфинала по месту отбора, дальше групповой этап.
 * Пока нет победителей финала и матча за 3-е место, таблицы нет.
 */
export declare function buildFinalStandings(input: {
    playoff: PlayoffProjection;
    leaderboard: readonly LeaderboardEntry[];
    participants: readonly StandingPerson[];
}): FinalStanding[] | null;
export {};
