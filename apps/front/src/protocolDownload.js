import { QUALIFYING_PERIODS } from "../../../packages/shared/src/types.ts";
import robotoBoldUrl from "./fonts/Roboto-Bold.ttf?url";
import robotoRegularUrl from "./fonts/Roboto-Regular.ttf?url";
const PDF_NAME = "kartochki-uchastnikov.pdf";
const XLSX_NAME = "setka-turnira.xlsx";
/** Портретный А4, четыре карточки на лист. */
const PAGE_W = 210;
const PAGE_H = 297;
const CARDS_PER_PAGE = 4;
const DRAW_COLUMNS = [
    { lines: ["период"], value: "period" },
    { lines: ["сектор"], value: "sector" },
    { lines: ["№", "соперника"], value: "opponent" },
    { lines: ["поимки", "свои"], value: "blank" },
    { lines: ["поимки", "соперника"], value: "blank" },
    { lines: ["подпись", "соперника"], value: "blank" },
    { lines: ["баллы"], value: "blank" },
];
/** Ширины под четверть листа. Подпись забирает остаток. */
function columnWidths(tableWidth) {
    const period = 10;
    const sector = 13;
    const opponent = 18;
    const ownCatch = 12.5;
    const opponentCatch = 14.5;
    const points = 10.5;
    const signature = tableWidth - (period + sector + opponent + ownCatch + opponentCatch + points);
    return [period, sector, opponent, ownCatch, opponentCatch, signature, points];
}
function cardBox(indexOnPage) {
    const col = indexOnPage % 2;
    const row = Math.floor(indexOnPage / 2);
    const cellW = PAGE_W / 2;
    const cellH = PAGE_H / 2;
    const inset = 4;
    return {
        x: col * cellW + inset,
        y: row * cellH + inset,
        w: cellW - inset * 2,
        h: cellH - inset * 2,
    };
}
function drawCutGuides(doc) {
    doc.setDrawColor(120);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([1.2, 1.1], 0);
    doc.line(PAGE_W / 2, 2, PAGE_W / 2, PAGE_H - 2);
    doc.line(2, PAGE_H / 2, PAGE_W - 2, PAGE_H / 2);
    doc.setLineDashPattern([], 0);
}
let robotoTask = null;
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const size = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += size) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
    }
    return btoa(binary);
}
function loadRoboto() {
    if (!robotoTask) {
        robotoTask = Promise.all([fetch(robotoRegularUrl), fetch(robotoBoldUrl)])
            .then(async ([regular, bold]) => {
            if (!regular.ok || !bold.ok)
                throw new Error("Шрифт карточек не загрузился");
            return {
                regular: arrayBufferToBase64(await regular.arrayBuffer()),
                bold: arrayBufferToBase64(await bold.arrayBuffer()),
            };
        })
            .catch((error) => {
            robotoTask = null;
            throw error;
        });
    }
    return robotoTask;
}
function mountRoboto(doc, fonts) {
    doc.addFileToVFS("Roboto-Regular.ttf", fonts.regular);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.addFileToVFS("Roboto-Bold.ttf", fonts.bold);
    doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");
}
function fontMm(sizePt) {
    return sizePt * 0.3528;
}
function baselineIn(y, height, sizePt) {
    return y + (height + fontMm(sizePt) * 0.72) / 2;
}
function drawCentered(doc, text, x, y, width, height, sizePt) {
    doc.setFontSize(sizePt);
    const textWidth = doc.getTextWidth(text);
    doc.text(text, x + (width - textWidth) / 2, baselineIn(y, height, sizePt));
}
function drawCenteredLines(doc, lines, x, y, width, height, sizePt) {
    doc.setFontSize(sizePt);
    const lineHeight = fontMm(sizePt) * 1.35;
    const block = lineHeight * lines.length;
    const first = y + (height - block) / 2 + fontMm(sizePt) * 0.82;
    lines.forEach((line, index) => {
        const textWidth = doc.getTextWidth(line);
        doc.text(line, x + (width - textWidth) / 2, first + index * lineHeight);
    });
}
function shrinkToWidth(doc, text, maxWidth, sizePt, minPt) {
    let size = sizePt;
    doc.setFontSize(size);
    while (size > minPt && doc.getTextWidth(text) > maxWidth) {
        size -= 0.5;
        doc.setFontSize(size);
    }
    return size;
}
function opponentText(period) {
    if (!period || period.opponentBib === null) {
        return period?.compareBib != null ? `- (${period.compareBib})` : "-";
    }
    return String(period.opponentBib);
}
function drawBankMark(doc, bank, x, y, width) {
    const size = 6.5;
    doc.setFont("Roboto", "bold");
    doc.setFontSize(size);
    const textWidth = doc.getTextWidth(bank);
    doc.text(bank, x + width - textWidth - 0.55, y + fontMm(size) + 0.35);
}
function drawCard(doc, card, indexOnPage) {
    const box = cardBox(indexOnPage);
    const x = box.x;
    const y = box.y;
    const width = box.w;
    const height = box.h;
    const idHeight = 8.2;
    const headHeight = 6.6;
    const rowHeight = (height - idHeight - headHeight) / 8;
    const widths = columnWidths(width);
    const numberWidth = (widths[0] ?? 0) + (widths[1] ?? 0) + (widths[2] ?? 0);
    doc.setTextColor(0);
    doc.setDrawColor(0);
    doc.setFont("Roboto", "bold");
    const labelSize = 7;
    doc.setFontSize(labelSize);
    doc.text("№", x + 1.4, baselineIn(y, idHeight, labelSize));
    drawCentered(doc, String(card.bibNumber), x, y, numberWidth, idHeight, 11);
    const nameLabel = "Ф.И.О.";
    doc.setFontSize(labelSize);
    const nameLabelX = x + numberWidth + 1.4;
    doc.text(nameLabel, nameLabelX, baselineIn(y, idHeight, labelSize));
    const name = card.displayName.replace(/\s+/g, " ").trim();
    if (name) {
        const nameX = nameLabelX + doc.getTextWidth(nameLabel) + 1.3;
        const nameMax = Math.max(8, x + width - 1.2 - nameX);
        const nameSize = shrinkToWidth(doc, name, nameMax, 8, 5.5);
        let printed = name;
        if (doc.getTextWidth(printed) > nameMax) {
            while (printed.length > 1 && doc.getTextWidth(`${printed}…`) > nameMax)
                printed = printed.slice(0, -1);
            printed = `${printed}…`;
        }
        doc.text(printed, nameX, baselineIn(y, idHeight, nameSize));
    }
    doc.setFont("Roboto", "normal");
    let headerX = x;
    const headerY = y + idHeight;
    DRAW_COLUMNS.forEach((column, index) => {
        drawCenteredLines(doc, column.lines, headerX, headerY, widths[index] ?? 0, headHeight, 6);
        headerX += widths[index] ?? 0;
    });
    const valueSize = 8;
    for (let index = 0; index < 8; index += 1) {
        const period = card.periods[index];
        const rowY = y + idHeight + headHeight + index * rowHeight;
        let cellX = x;
        DRAW_COLUMNS.forEach((column, columnIndex) => {
            const cellWidth = widths[columnIndex] ?? 0;
            doc.setFont("Roboto", "bold");
            if (column.value === "period") {
                drawCentered(doc, period ? String(period.period) : String(index + 1), cellX, rowY, cellWidth, rowHeight, valueSize);
            }
            else if (column.value === "sector") {
                drawCentered(doc, period?.sectorId.trim() ? period.sectorId : "—", cellX, rowY, cellWidth, rowHeight, valueSize);
                if (period?.bank)
                    drawBankMark(doc, period.bank, cellX, rowY, cellWidth);
            }
            else if (column.value === "opponent") {
                drawCentered(doc, opponentText(period), cellX, rowY, cellWidth, rowHeight, valueSize);
            }
            cellX += cellWidth;
        });
    }
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.line(x + numberWidth, y, x + numberWidth, y + idHeight);
    doc.line(x, y + idHeight, x + width, y + idHeight);
    doc.line(x, y + idHeight + headHeight, x + width, y + idHeight + headHeight);
    for (let index = 1; index < 8; index += 1) {
        const lineY = y + idHeight + headHeight + index * rowHeight;
        doc.line(x, lineY, x + width, lineY);
    }
    let ruleX = x;
    widths.slice(0, -1).forEach((columnWidth) => {
        ruleX += columnWidth;
        doc.line(ruleX, y + idHeight, ruleX, y + height);
    });
    doc.setLineWidth(0.4);
    doc.rect(x, y, width, height);
}
/** Четыре бланка на портретный А4. Пунктир — линия разреза. */
export function renderParticipantCardsPdf(doc, cards, fonts) {
    mountRoboto(doc, fonts);
    const pageCount = Math.max(1, Math.ceil(cards.length / CARDS_PER_PAGE));
    for (let page = 0; page < pageCount; page += 1) {
        if (page > 0)
            doc.addPage("a4", "portrait");
        drawCutGuides(doc);
        const slice = cards.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE);
        slice.forEach((card, index) => drawCard(doc, card, index));
    }
}
export async function downloadParticipantCardsPdf(cards) {
    if (cards.length === 0)
        throw new Error("Нет участников для карточек");
    const [{ jsPDF }, fonts] = await Promise.all([import("jspdf"), loadRoboto()]);
    const doc = new jsPDF({
        unit: "mm",
        format: "a4",
        orientation: "portrait",
        compress: true,
        putOnlyUsedFonts: true,
    });
    renderParticipantCardsPdf(doc, cards, fonts);
    doc.save(PDF_NAME);
}
function excelText(value) {
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
function seatLine(bibNumber, displayName, side) {
    const bank = side === "left" ? "слева" : "справа";
    return `№${bibNumber} ${displayName} ${bank}`;
}
/** Сектор × восемь туров: кто стоит в секторе в каждом туре. */
export function transitionMatrix(participants, grid) {
    const people = new Map(participants.filter((person) => !person.ghost).map((person) => [person.slotId, person]));
    const bySector = new Map();
    for (const slot of grid) {
        if (slot.round !== 1 || !QUALIFYING_PERIODS.includes(slot.period))
            continue;
        const person = people.get(slot.slotId);
        if (!person)
            continue;
        const periods = bySector.get(slot.sectorId) ?? new Map();
        const seats = periods.get(slot.period) ?? [];
        if (!seats.some((seat) => seat.bibNumber === person.bibNumber)) {
            seats.push({ bibNumber: person.bibNumber, displayName: person.displayName, side: slot.side });
        }
        periods.set(slot.period, seats);
        bySector.set(slot.sectorId, periods);
    }
    const header = ["Сектор", ...QUALIFYING_PERIODS.map((period) => `Тур ${period}`)];
    const sectors = [...bySector.keys()].sort((left, right) => left.localeCompare(right, "ru", { numeric: true }));
    const rows = sectors.map((sectorId) => {
        const periods = bySector.get(sectorId);
        return [
            sectorId,
            ...QUALIFYING_PERIODS.map((period) => {
                const seats = (periods?.get(period) ?? [])
                    .slice()
                    .sort((left, right) => (left.side === right.side ? left.bibNumber - right.bibNumber : left.side === "left" ? -1 : 1));
                return seats.map((seat) => seatLine(seat.bibNumber, seat.displayName, seat.side)).join(" / ");
            }),
        ];
    });
    return [header, ...rows];
}
export function startListRows(participants) {
    const living = participants
        .filter((person) => !person.ghost)
        .slice()
        .sort((left, right) => left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId));
    return [["№", "ФИО"], ...living.map((person) => [person.bibNumber, excelText(person.displayName)])];
}
export async function downloadTournamentWorkbook(participants, grid) {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    const start = XLSX.utils.aoa_to_sheet(startListRows(participants));
    start["!cols"] = [{ wch: 6 }, { wch: 42 }];
    const matrix = XLSX.utils.aoa_to_sheet(transitionMatrix(participants, grid));
    matrix["!cols"] = [{ wch: 10 }, ...QUALIFYING_PERIODS.map(() => ({ wch: 42 }))];
    XLSX.utils.book_append_sheet(book, start, "Стартовый список");
    XLSX.utils.book_append_sheet(book, matrix, "Матрица переходов");
    XLSX.writeFile(book, XLSX_NAME);
}
