import { type GridSlot, type LeaderboardEntry, type PeriodIndex, type PeriodPoints } from "../../../packages/shared/src/types.ts";
import { type RegisteredParticipant } from "./store.ts";
/** «[№3] Бакладоров К.» — номер жеребьёвки и ФИО. */
export declare function formatDrawName(bibNumber: number, displayName: string): string;
export interface ParticipantCardPeriod {
    period: PeriodIndex;
    sectorId: string;
    /** «л» — левый борт, «п» — правый. На бланке стоит в углу ячейки сектора. */
    bank: "л" | "п" | null;
    /** ID соперника в сетке Бергера. `GHOST`, если в секторе один спортсмен. */
    opponentSlotId: string | null;
    opponentBib: number | null;
    /** Номер соседа, с кем сравнивают одиночку. На бланке: `- (5)`. */
    compareBib: number | null;
    ownFish: number;
    opponentFish: number;
    points: PeriodPoints;
    played: boolean;
}
/** Цифровой бланк одного участника: восемь периодов сетки Бергера. */
export interface ParticipantCard {
    slotId: string;
    bibNumber: number;
    displayName: string;
    periods: ParticipantCardPeriod[];
}
/** Плоская строка сетки для листа Excel. */
export interface TournamentGridRow {
    bibNumber: number;
    displayName: string;
    slotId: string;
    period: PeriodIndex;
    sectorId: string;
    opponentSlotId: string;
    opponentBib: number | null;
    ownFish: number;
    opponentFish: number;
    points: PeriodPoints;
    played: boolean;
}
/** Собранные страницы карточек. Файл пишет `downloadParticipantCardsPdf`. */
export interface PdfCardStub {
    library: "jspdf";
    integrated: true;
    filename: string;
    pageCount: number;
    cards: ParticipantCard[];
}
/** Строки сетки до записи книги. Файл пишет `downloadTournamentWorkbook`: стартовый список и матрица переходов. */
export interface XlsxGridStub {
    library: "xlsx";
    integrated: true;
    filename: string;
    sheetName: string;
    rows: TournamentGridRow[];
}
export declare function facingFish(leaderboard: readonly LeaderboardEntry[], slotId: string, period: PeriodIndex, scoringOpponentSlotId: string | null): {
    ownFish: number;
    opponentFish: number;
    points: PeriodPoints;
    played: boolean;
};
export declare function buildParticipantCards(participants: readonly RegisteredParticipant[], grid: readonly GridSlot[], leaderboard: readonly LeaderboardEntry[]): ParticipantCard[];
export declare function prepareParticipantCardsPdf(cards: readonly ParticipantCard[]): PdfCardStub;
export declare function prepareTournamentGridXlsx(cards: readonly ParticipantCard[]): XlsxGridStub;
export declare function ProtocolExportButtons({ grid, middle }: {
    grid?: readonly GridSlot[];
    middle?: import("react").ReactNode;
}): import("react").JSX.Element;
