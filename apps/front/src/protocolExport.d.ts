import { type GridSlot, type LeaderboardEntry, type PeriodIndex, type PeriodPoints } from "../../../packages/shared/src/types.ts";
import { type RegisteredParticipant } from "./store.ts";
/** «[№3] Бакладоров К.» — номер жеребьёвки и ФИО. */
export declare function formatDrawName(bibNumber: number, displayName: string): string;
export interface ParticipantCardPeriod {
    period: PeriodIndex;
    sectorId: string;
    /** ID соперника в сетке Бергера. `GHOST`, если в секторе один спортсмен. */
    opponentSlotId: string | null;
    opponentBib: number | null;
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
/**
 * Заготовка PDF. Сюда подключается jspdf:
 *   const { jsPDF } = await import("jspdf");
 *   const doc = new jsPDF();
 *   for (const card of stub.cards) { ...страница бланка... }
 *   doc.save(stub.filename);
 * Пока библиотеки нет: файл не пишется, наружу уходят готовые страницы.
 */
export interface PdfCardStub {
    library: "jspdf";
    integrated: false;
    filename: string;
    pageCount: number;
    cards: ParticipantCard[];
}
/**
 * Заготовка книги Excel. Сюда подключается xlsx:
 *   const XLSX = await import("xlsx");
 *   const sheet = XLSX.utils.json_to_sheet(stub.rows);
 *   const book = XLSX.utils.book_new();
 *   XLSX.utils.book_append_sheet(book, sheet, stub.sheetName);
 *   XLSX.writeFile(book, stub.filename);
 * Пока библиотеки нет: файл не пишется, наружу уходят строки сетки.
 */
export interface XlsxGridStub {
    library: "xlsx";
    integrated: false;
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
export declare function ProtocolExportButtons({ grid }: {
    grid?: readonly GridSlot[];
}): import("react").JSX.Element;
