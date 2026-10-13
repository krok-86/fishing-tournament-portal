import type { GridSlot, GroupId, PeriodIndex, PeriodPhase, PlayoffStage, RoundIndex, TournamentEvent } from "../../../packages/shared/src/types.ts";
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
    /** Период, который телефон игрока вложил в код при сдаче. Сирену орга не перебивает. */
    mark?: string;
    /** Сколько периодов QR не совпали с уже записанным счётом. */
    disputes?: number;
}
export type PlayerQrImportResult = {
    ok: true;
    packet: PlayerQrImport;
} | {
    ok: false;
    error: string;
};
export interface PeriodMark {
    period: PeriodIndex;
    phase: PeriodPhase;
}
export type DecodedCatchSnapshot = {
    ok: true;
    mode: "qualifying";
    bibNumber: number;
    cells: readonly QrCatchCell[];
    mark: PeriodMark | null;
    displayName: string | null;
} | {
    ok: true;
    mode: "playoff";
    bibNumber: number;
    cells: readonly QrPlayoffCell[];
    mark: PeriodMark | null;
    displayName: string | null;
} | {
    ok: false;
    error: string;
};
/** Сумма несинхронизированных дельт. Закрытый период без поимок уходит как ноль. */
export declare function snapshotFromEvents(records: readonly SyncRecord[], slotId: string, live: LiveCatch | null): QrCatchCell[];
export declare function encodeCatchSnapshot(bibNumber: number, cells: readonly QrCatchCell[], mark?: PeriodMark | null, displayName?: string | null): string;
/** FTP1|4|QF|1=3 или несколько стадий: FTP1|4|QF|1=3;SF|1=2 */
export declare function encodePlayoffSnapshot(bibNumber: number, cells: readonly QrPlayoffCell[], mark?: PeriodMark | null, displayName?: string | null): string;
export declare function playoffMatchId(stage: PlayoffStageCode, pair: number): string;
export declare function playoffStageCode(stage: PlayoffStage): PlayoffStageCode;
export declare function decodeCatchSnapshot(raw: string): DecodedCatchSnapshot;
export declare function expandCatchEvents(tournamentId: string, slotId: string, cells: readonly QrCatchCell[], timestamp: number): TournamentEvent[];
export declare function totalFish(cells: readonly {
    fish: number;
}[]): number;
export declare function periodStatusLabel(period: number, phase: PeriodPhase): string;
/** Короткий код сирены. Игрок сканирует его, когда сдаёт результат или слышит сигнал. */
export declare function encodePeriodSignal(period: PeriodIndex, phase: PeriodPhase): string;
export declare function decodePeriodSignal(raw: string): {
    ok: true;
    mark: PeriodMark;
} | {
    ok: false;
    error: string;
};
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
export declare function isTournamentDate(value: string): boolean;
export type StartDecodeResult = {
    ok: true;
    snapshot: StartSnapshot;
} | {
    ok: false;
    error: string;
};
export declare function seatsFromGrid(grid: readonly GridSlot[], bibBySlot: ReadonlyMap<string, number>): StartSeat[];
export declare function serializeStartSnapshot(snapshot: StartSnapshot): string;
export declare function encodeStartSnapshot(snapshot: StartSnapshot): Promise<string>;
export declare function decodeStartSnapshot(raw: string): Promise<StartDecodeResult>;
export declare function parseStartSnapshot(plain: string): StartDecodeResult;
export {};
