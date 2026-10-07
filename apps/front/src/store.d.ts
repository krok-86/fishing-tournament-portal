import { type FishDelta, type GridSlot, type GroupId, type LeaderboardEntry, type MatrixDuel, type PeriodIndex, type PlayoffProjection, type RoundIndex } from "../../../packages/shared/src/types.ts";
import { type PlayerQrExportResult, type PlayerQrImportResult } from "./qrSync.ts";
export interface RegisteredParticipant {
    slotId: string;
    bibNumber: number;
    displayName: string;
    groupId: GroupId;
    /** Не пришёл: слот и номер жеребьёвки сохраняются. */
    ghost: boolean;
}
export interface PendingCatch {
    slotId: string;
    delta: FishDelta;
}
interface SectorView {
    sectorLabel: string;
    sideLabel: "СЛЕВА" | "СПРАВА";
    athleteSlotId: string;
    opponentSlotId: string;
    athleteName: string;
    opponentName: string;
    /** «Вы в секторе 1 СЛЕВА, ваш соперник Спортсмен №2» */
    briefing: string;
}
interface MatchStore extends SectorView {
    tournamentId: string;
    round: RoundIndex;
    period: PeriodIndex;
    athleteFish: number;
    opponentFish: number;
    secondsLeft: number;
    pending: PendingCatch[];
    confirmed: boolean;
    saving: boolean;
    savedCount: number | null;
    error: string | null;
    leaderboard: LeaderboardEntry[];
    leaderboardReady: boolean;
    participants: RegisteredParticipant[];
    /** Сетка всех периодов. Пустая, пока турнир не открыт. */
    grid: GridSlot[];
    sectorCount: number;
    tournamentOpened: boolean;
    setupSaving: boolean;
    setupError: string | null;
    hydrated: boolean;
    /** Сетка кубка. Пустая, пока не записан FORM_PLAYOFF. */
    playoff: PlayoffProjection;
    /** Все живые слоты 8-го периода закрыты протоколом. */
    eighthPeriodClosed: boolean;
    selectedPlayoffMatchId: string;
    /** Окно ввода поимок выбранной кубковой пары. */
    playoffEntryOpen: boolean;
    playoffSaving: boolean;
    playoffError: string | null;
    adjustFish: (who: "athlete" | "opponent", delta: FishDelta) => void;
    /** Период отбора 1–8. */
    setPeriod: (period: PeriodIndex) => void;
    tick: () => void;
    confirmPeriod: () => Promise<void>;
    loadLeaderboard: () => Promise<LeaderboardEntry[]>;
    hydrate: () => Promise<void>;
    registerParticipant: (displayName: string) => Promise<boolean>;
    /** Пачка «Спортсмен №1…N» на пустой стартовый лист. */
    seedNumberedStart: (count: number) => Promise<boolean>;
    /**
     * Одна пачка из JSON онлайн-регистрации.
     * Форма файла: { "participants": [{ "bibNumber": 1, "displayName": "Иванов", "groupId": "A" }] }
     */
    importRegistrationBatch: (value: unknown) => Promise<boolean>;
    replaceParticipant: (slotId: string, displayName: string) => Promise<boolean>;
    setParticipantGhost: (slotId: string) => Promise<boolean>;
    removeParticipant: (slotId: string) => Promise<boolean>;
    clearParticipants: () => Promise<boolean>;
    /** Стирает журнал, участников и сетку. Экран возвращается к новой жеребьёвке. */
    resetTournament: () => Promise<boolean>;
    /**
     * Строит матрицу переходов на все периоды, пишет матчи в IndexedDB
     * и переводит экран ввода в боевой режим.
     */
    startTournament: () => Promise<boolean>;
    openTournament: () => Promise<boolean>;
    /** Номер на этом телефоне. Кубковый QR кодирует его поимки. */
    selfSlotId: string;
    /** Номер рыбака на экране ввода: сектор, сторона и соперник из сетки текущего периода. */
    selectAthlete: (slotId: string) => void;
    /** Несинхронизированные поимки выбранного номера, сжатые в строку QR. */
    exportAthleteResults: () => Promise<PlayerQrExportResult>;
    /** Вписывает строку QR в журнал и помечает эти поимки синхронизированными. */
    importAthleteResults: (payload: string) => Promise<PlayerQrImportResult>;
    /** Топ-8 после 8-го периода: пары 1–8, 2–7, 3–6, 4–5. Пишет FORM_PLAYOFF. */
    formPlayoff: () => Promise<boolean>;
    selectPlayoffMatch: (matchId: string) => void;
    /** Открывает окно поимок четвертьфинала, полуфинала или финала. */
    openPlayoffEntry: (matchId: string) => void;
    closePlayoffEntry: () => void;
}
export declare const useMatchStore: import("zustand").UseBoundStore<import("zustand").StoreApi<MatchStore>>;
/** Одна строка пачки. Так выглядит участник в JSON онлайн-регистрации. */
export interface RegistrationBatchEntry {
    displayName: string;
    bibNumber?: number;
    groupId?: GroupId;
}
/** Файл, скачанный до выезда. На берегу его принимает importRegistrationBatch. */
export interface RegistrationBatch {
    participants: readonly RegistrationBatchEntry[];
}
export type RegistrationBatchResult = {
    ok: true;
    batch: RegistrationBatch;
} | {
    ok: false;
    error: string;
};
export declare function numberedAthleteName(bibNumber: number): string;
export declare function numberedRegistrationBatch(count: number): RegistrationBatch;
export declare function parseRegistrationBatch(value: unknown): RegistrationBatchResult;
/** PAL Trout: одна пара на сектор, нечётный участник занимает сектор один. */
export declare function requiredSectorCount(participantCount: number): number;
/** Имя фантома. Номер жеребьёвки в имени — тот же слот, не новый участник. */
export declare function phantomName(bibNumber: number): string;
/**
 * Период 1 полной сетки. Борт чередуется по номеру, а не по тому, чей номер меньше.
 * Фантом место не освобождает: живой соперник остаётся один.
 */
export declare function planPeriodOne(participants: readonly RegisteredParticipant[], sectorCount: number): MatrixDuel[];
/** Другое место того же сектора, если там фантом. */
export declare function ghostSeatPartner(participants: readonly RegisteredParticipant[], sectorCount: number, slotId: string): RegisteredParticipant | null;
/** Ближайший живой сосед по секторам. Очки одиночки считаются против него, ему эти очки не идут. */
export declare function loneNeighborSlotId(participants: readonly RegisteredParticipant[], sectorCount: number, loneSlotId: string): string | null;
export declare function waitingParticipants(participants: readonly RegisteredParticipant[], sectorCount: number): RegisteredParticipant[];
export declare function formatClock(totalSeconds: number): string;
export {};
