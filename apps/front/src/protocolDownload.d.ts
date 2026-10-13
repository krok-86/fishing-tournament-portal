import type { jsPDF } from "jspdf";
import { type GridSlot } from "../../../packages/shared/src/types.ts";
/** Печатный бланк: номер, ФИО и восемь строк жеребьёвки. Поимки, подпись и баллы на листе пустые. */
export interface PrintCard {
    bibNumber: number;
    displayName: string;
    periods: readonly {
        period: number;
        sectorId: string;
        /** «л» слева, «п» справа. */
        bank: "л" | "п" | null;
        opponentBib: number | null;
        /** Сосед одиночки. Печатается как `- (5)`, если своей пары нет. */
        compareBib: number | null;
    }[];
}
export interface StartListPerson {
    slotId: string;
    bibNumber: number;
    displayName: string;
    ghost: boolean;
}
interface RobotoFiles {
    regular: string;
    bold: string;
}
/** Четыре бланка на портретный А4. Пунктир — линия разреза. */
export declare function renderParticipantCardsPdf(doc: jsPDF, cards: readonly PrintCard[], fonts: RobotoFiles): void;
export declare function downloadParticipantCardsPdf(cards: readonly PrintCard[]): Promise<void>;
/** Сектор × восемь туров: кто стоит в секторе в каждом туре. */
export declare function transitionMatrix(participants: readonly StartListPerson[], grid: readonly GridSlot[]): string[][];
export declare function startListRows(participants: readonly StartListPerson[]): (string | number)[][];
export declare function downloadTournamentWorkbook(participants: readonly StartListPerson[], grid: readonly GridSlot[]): Promise<void>;
export {};
