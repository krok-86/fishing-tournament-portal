import type { PeriodIndex, RoundIndex, TournamentEvent } from "../../../packages/shared/src/types.ts";
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
export type PlayoffStageCode = "QF" | "SF" | "F";
export interface QrPlayoffCell {
    stage: PlayoffStageCode;
    /** Номер пары с 1: четвертьфинал 1–4, полуфинал 1–2, финал 1. */
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
}
export type PlayerQrExportResult = {
    ok: true;
    packet: PlayerQrPacket;
} | {
    ok: false;
    error: string;
};
export interface PlayerQrImport {
    bibNumber: number;
    displayName: string;
    fish: number;
    periods: number;
    /** Текст для вкладки организатора, когда строка была кубковой. */
    cup?: string;
}
export type PlayerQrImportResult = {
    ok: true;
    packet: PlayerQrImport;
} | {
    ok: false;
    error: string;
};
export type DecodedCatchSnapshot = {
    ok: true;
    mode: "qualifying";
    bibNumber: number;
    cells: readonly QrCatchCell[];
} | {
    ok: true;
    mode: "playoff";
    bibNumber: number;
    cells: readonly QrPlayoffCell[];
} | {
    ok: false;
    error: string;
};
/** Сумма несинхронизированных дельт. Закрытый период без поимок уходит как ноль. */
export declare function snapshotFromEvents(records: readonly SyncRecord[], slotId: string, live: LiveCatch | null): QrCatchCell[];
export declare function encodeCatchSnapshot(bibNumber: number, cells: readonly QrCatchCell[]): string;
/** FTP1|4|QF|1=3 или несколько стадий: FTP1|4|QF|1=3;SF|1=2 */
export declare function encodePlayoffSnapshot(bibNumber: number, cells: readonly QrPlayoffCell[]): string;
export declare function playoffMatchId(stage: PlayoffStageCode, pair: number): string;
export declare function playoffStageCode(stage: "quarterfinal" | "semifinal" | "final"): PlayoffStageCode;
export declare function decodeCatchSnapshot(raw: string): DecodedCatchSnapshot;
export declare function expandCatchEvents(tournamentId: string, slotId: string, cells: readonly QrCatchCell[], timestamp: number): TournamentEvent[];
export declare function totalFish(cells: readonly {
    fish: number;
}[]): number;
export {};
