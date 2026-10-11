import { type FishDelta, type GridSlot, type GroupId, type LeaderboardEntry, type MatrixDuel, type PeriodIndex, type PeriodPhase, type PlayoffProjection, type RoundIndex, type Side } from "../../../packages/shared/src/types.ts";
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
    /** «Спортсмен №5 Иванов», когда в секторе нет живого соперника. */
    neighborLabel: string;
}
interface MatchStore extends SectorView {
    tournamentId: string;
    round: RoundIndex;
    period: PeriodIndex;
    /** Сирена орга: ожидание, ловля или период закрыт. Часы телефона сюда не входят. */
    periodPhase: PeriodPhase;
    /** Организатор нажал «Запустить период». До этого текущий период — всегда 1. */
    officiallyStarted: boolean;
    athleteFish: number;
    opponentFish: number;
    athleteExtraFish: number;
    opponentExtraFish: number;
    athleteGoldenFish: number;
    opponentGoldenFish: number;
    goldenFirst: "a" | "b" | null;
    playoffDraftActive: boolean;
    pending: PendingCatch[];
    confirmed: boolean;
    saving: boolean;
    savedCount: number | null;
    error: string | null;
    leaderboard: LeaderboardEntry[];
    leaderboardReady: boolean;
    participants: RegisteredParticipant[];
    /** Номера, для которых на этом телефоне уже записано ФИО игрока. */
    playerNamedSlotIds: string[];
    /** Сетка всех периодов. Пустая, пока турнир не открыт. */
    grid: GridSlot[];
    sectorCount: number;
    /** Сколько периодов отбора в сетке. Пока 8, число приходит из открытия турнира. */
    periodsCount: number;
    tournamentOpened: boolean;
    /** Название, которое игрок видит после сканирования жеребьёвки. */
    tournamentName: string;
    /** День проведения, ISO `YYYY-MM-DD`. */
    tournamentDate: string;
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
    adjustPlayoffLine: (phase: "extra" | "golden", who: "athlete" | "opponent", delta: FishDelta) => void;
    setGoldenFirst: (side: "a" | "b") => void;
    /** Период отбора 1–8. Пишет тот же сигнал, что и сирена орга. */
    setPeriod: (period: PeriodIndex) => void;
    /** Записать активный период и фазу сирены. Игрок без связи вызывает это вручную. */
    signalPeriod: (period: PeriodIndex, phase: PeriodPhase) => Promise<boolean>;
    signalSaving: boolean;
    /**
     * Телефон игрока принимает стартовый QR или короткий сигнал периода.
     * Стартовый код пишет сетку в IndexedDB и открывает ввод поимок.
     */
    acceptOrganizerCode: (payload: string) => Promise<{
        ok: true;
        fresh: boolean;
        label: string;
    } | {
        ok: false;
        error: string;
    }>;
    /**
     * Подтверждение периода игрока или дуэли.
     * `asOrganizer` — ввод поимок в сетке кубка: ФИО на этом телефоне не требуется.
     */
    confirmPeriod: (asOrganizer?: boolean) => Promise<void>;
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
    /**
     * До открытия турнира фантома не создаёт: строка снимается целиком, номера смыкаются.
     * После открытия пустой слот с этого экрана не ставится.
     */
    setParticipantGhost: (slotId: string) => Promise<boolean>;
    removeParticipant: (slotId: string) => Promise<boolean>;
    clearParticipants: () => Promise<boolean>;
    /** Стирает журнал, участников и сетку. Экран возвращается к новой жеребьёвке. */
    resetTournament: () => Promise<boolean>;
    /**
     * Строит матрицу переходов на все периоды, пишет матчи в IndexedDB
     * и переводит экран ввода в боевой режим.
     */
    startTournament: (meta?: {
        name: string;
        date: string;
    }) => Promise<boolean>;
    openTournament: () => Promise<boolean>;
    /** Номер на этом телефоне. Кубковый QR кодирует его поимки. */
    selfSlotId: string;
    /** Номер рыбака на экране ввода: сектор, сторона и соперник из сетки текущего периода. */
    selectAthlete: (slotId: string) => void;
    /** Несинхронизированные поимки выбранного номера, сжатые в строку QR. */
    exportAthleteResults: () => Promise<PlayerQrExportResult>;
    /** Вписывает строку QR в журнал и помечает эти поимки синхронизированными. */
    importAthleteResults: (payload: string) => Promise<PlayerQrImportResult>;
    /** Этот номер закрыл 8-й период: один QR может унести весь отбор. */
    qualifyingHandoffReady: boolean;
    /** Сколько периодов 1–8 этот номер уже сохранил на телефоне. */
    qualifyingSavedCount: number;
    /** Есть несинхронизированный кубковый матч выбранного номера. */
    cupHandoffReady: boolean;
    refreshHandoff: () => Promise<void>;
    /**
     * Ручная правка поимок обеих сторон дуэли.
     * Баллы в журнал не пишутся: после записи их заново считает калькулятор.
     */
    correctPeriodFish: (slotId: string, period: PeriodIndex, ownFish: number, opponentFish: number) => Promise<string | null>;
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
 * Период 1 полной сетки. Нечётный номер слева, чётный справа.
 * Фантом место не освобождает: живой соперник остаётся один.
 */
export declare function planPeriodOne(participants: readonly RegisteredParticipant[], sectorCount: number): MatrixDuel[];
/** Сетка переходов на все периоды. Тот же расчёт, что пишется в журнал при открытии. */
export declare function scheduleGrid(participants: readonly RegisteredParticipant[], periodsCount: number): GridSlot[];
export type PeriodSector = {
    sectorId: string;
    kind: "pair";
    leftSlotId: string;
    rightSlotId: string;
} | {
    sectorId: string;
    kind: "lone";
    slotId: string;
    side: Side;
    /** Напротив живого места стоит фантом, а не пустой пропуск Бергера. */
    vacant: boolean;
    neighborSlotId: string | null;
};
/** Секторы одного периода из уже посчитанной сетки. Сосед одиночки берётся из этого же периода. */
export declare function sectorsForPeriod(grid: readonly GridSlot[], participants: readonly RegisteredParticipant[], period: PeriodIndex): PeriodSector[];
export interface PeriodSeat {
    sectorId: string;
    /** С кем сравниваются поимки: соперник пары или сосед одиночки. */
    opponentSlotId: string | null;
    /** Соперник в сетке Бергера. У одиночки это GHOST. */
    bergerOpponentSlotId: string | null;
}
/** Сектор, соперник Бергера и соперник для счёта в одном периоде. */
export declare function periodSeat(grid: readonly GridSlot[], participants: readonly RegisteredParticipant[], slotId: string, period: PeriodIndex): PeriodSeat | null;
/** Другое место того же сектора в первом периоде, если там фантом или GHOST. */
export declare function ghostSeatPartner(participants: readonly RegisteredParticipant[], _sectorCount: number, slotId: string): RegisteredParticipant | null;
/** Ближайший живой сосед по карте секторов первого периода. Очки одиночки считаются против него. */
export declare function loneNeighborSlotId(participants: readonly RegisteredParticipant[], _sectorCount: number, loneSlotId: string): string | null;
export declare function waitingParticipants(participants: readonly RegisteredParticipant[], sectorCount: number): RegisteredParticipant[];
/** Настоящее ФИО: не короче трёх символов и не служебное «Спортсмен №N» / «ФАНТОМ N». */
export declare function isRealAthleteName(displayName: string, bibNumber: number): boolean;
export {};
