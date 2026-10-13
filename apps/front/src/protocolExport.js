import { useState } from "react";
import { isGhostOpponent } from "../../../packages/shared/src/calculator.ts";
import { QUALIFYING_PERIODS, } from "../../../packages/shared/src/types.ts";
import { downloadParticipantCardsPdf, downloadTournamentWorkbook } from "./protocolDownload.ts";
import { periodSeat, useMatchStore } from "./store.ts";
import { toast } from "./toast.ts";
/** «[№3] Бакладоров К.» — номер жеребьёвки и ФИО. */
export function formatDrawName(bibNumber, displayName) {
    return `[№${bibNumber}] ${displayName}`;
}
export function facingFish(leaderboard, slotId, period, scoringOpponentSlotId) {
    const cell = leaderboard.find((row) => row.slotId === slotId)?.periods.find((item) => item.period === period);
    if (cell?.played) {
        return { ownFish: cell.fish, opponentFish: cell.opponentFish, points: cell.points, played: true };
    }
    const opponentCell = scoringOpponentSlotId
        ? leaderboard.find((row) => row.slotId === scoringOpponentSlotId)?.periods.find((item) => item.period === period)
        : undefined;
    return {
        ownFish: 0,
        opponentFish: opponentCell?.played ? opponentCell.fish : 0,
        points: 0,
        played: false,
    };
}
export function buildParticipantCards(participants, grid, leaderboard) {
    const bibOf = new Map(participants.map((participant) => [participant.slotId, participant.bibNumber]));
    return participants
        .filter((participant) => !participant.ghost)
        .slice()
        .sort((left, right) => left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId))
        .map((participant) => ({
        slotId: participant.slotId,
        bibNumber: participant.bibNumber,
        displayName: participant.displayName,
        periods: QUALIFYING_PERIODS.map((period) => {
            const seat = periodSeat(grid, participants, participant.slotId, period);
            const drawn = grid.find((slot) => slot.round === 1 && slot.period === period && slot.slotId === participant.slotId);
            const bergerId = seat?.bergerOpponentSlotId ?? null;
            const scoringId = seat?.opponentSlotId ?? null;
            const fish = facingFish(leaderboard, participant.slotId, period, scoringId);
            const berger = bergerId ? participants.find((person) => person.slotId === bergerId) : undefined;
            const opponentMissing = !berger || berger.ghost || isGhostOpponent(bergerId);
            const opponentBib = !opponentMissing && berger ? berger.bibNumber : null;
            const compareBib = opponentMissing && scoringId && !isGhostOpponent(scoringId) ? (bibOf.get(scoringId) ?? null) : null;
            return {
                period,
                sectorId: seat?.sectorId ?? "",
                bank: drawn?.side === "left" ? "л" : drawn?.side === "right" ? "п" : null,
                opponentSlotId: bergerId,
                opponentBib,
                compareBib,
                ownFish: fish.ownFish,
                opponentFish: fish.opponentFish,
                points: fish.points,
                played: fish.played,
            };
        }),
    }));
}
export function prepareParticipantCardsPdf(cards) {
    return {
        library: "jspdf",
        integrated: true,
        filename: "kartochki-uchastnikov.pdf",
        pageCount: cards.length,
        cards: cards.map((card) => ({ ...card, periods: card.periods.map((period) => ({ ...period })) })),
    };
}
export function prepareTournamentGridXlsx(cards) {
    const rows = cards.flatMap((card) => card.periods.map((period) => ({
        bibNumber: card.bibNumber,
        displayName: card.displayName,
        slotId: card.slotId,
        period: period.period,
        sectorId: period.sectorId,
        opponentSlotId: period.opponentSlotId ?? "",
        opponentBib: period.opponentBib,
        ownFish: period.ownFish,
        opponentFish: period.opponentFish,
        points: period.points,
        played: period.played,
    })));
    return {
        library: "xlsx",
        integrated: true,
        filename: "setka-turnira.xlsx",
        sheetName: "Сетка",
        rows,
    };
}
export function ProtocolExportButtons({ grid, middle, }) {
    const participants = useMatchStore((state) => state.participants);
    const leaderboard = useMatchStore((state) => state.leaderboard);
    const storeGrid = useMatchStore((state) => state.grid);
    const draw = grid ?? storeGrid;
    const ready = participants.some((participant) => !participant.ghost) && draw.length > 0;
    const [busy, setBusy] = useState(null);
    function cards() {
        return buildParticipantCards(participants, draw, leaderboard);
    }
    return (<div className={`grid gap-2 ${middle ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      <button type="button" className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500" disabled={!ready || busy !== null} onClick={() => {
            const list = cards();
            if (list.length === 0) {
                toast("err", "Нет участников для карточек");
                return;
            }
            setBusy("pdf");
            void downloadParticipantCardsPdf(list)
                .then(() => {
                toast("ok", `Карточки скачаны: ${list.length}`);
            })
                .catch(() => {
                toast("err", "Не удалось собрать PDF");
            })
                .finally(() => setBusy(null));
        }}>
        {busy === "pdf" ? "Собираем PDF…" : "Скачать карточки участников (PDF)"}
      </button>
      {middle}
      <button type="button" className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500" disabled={!ready || busy !== null} onClick={() => {
            const list = cards();
            if (list.length === 0) {
                toast("err", "Сетка турнира пуста");
                return;
            }
            setBusy("xlsx");
            void downloadTournamentWorkbook(participants, draw)
                .then(() => {
                toast("ok", "Сетка турнира скачана");
            })
                .catch(() => {
                toast("err", "Не удалось собрать Excel");
            })
                .finally(() => setBusy(null));
        }}>
        {busy === "xlsx" ? "Собираем Excel…" : "Скачать сетку турнира (Excel)"}
      </button>
    </div>);
}
