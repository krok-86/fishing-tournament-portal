import { isGhostOpponent } from "../../../packages/shared/src/calculator.ts";
import { QUALIFYING_PERIODS, } from "../../../packages/shared/src/types.ts";
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
            const bergerId = seat?.bergerOpponentSlotId ?? null;
            const scoringId = seat?.opponentSlotId ?? null;
            const fish = facingFish(leaderboard, participant.slotId, period, scoringId);
            const opponentBib = bergerId && !isGhostOpponent(bergerId) ? (bibOf.get(bergerId) ?? null) : null;
            return {
                period,
                sectorId: seat?.sectorId ?? "",
                opponentSlotId: bergerId,
                opponentBib,
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
        integrated: false,
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
        integrated: false,
        filename: "setka-turnira.xlsx",
        sheetName: "Сетка",
        rows,
    };
}
export function ProtocolExportButtons({ grid }) {
    const participants = useMatchStore((state) => state.participants);
    const leaderboard = useMatchStore((state) => state.leaderboard);
    const storeGrid = useMatchStore((state) => state.grid);
    const draw = grid ?? storeGrid;
    const ready = participants.some((participant) => !participant.ghost) && draw.length > 0;
    function cards() {
        return buildParticipantCards(participants, draw, leaderboard);
    }
    return (<div className="grid gap-2 sm:grid-cols-2">
      <button type="button" className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500" disabled={!ready} onClick={() => {
            const pdf = prepareParticipantCardsPdf(cards());
            if (pdf.pageCount === 0) {
                toast("err", "Нет участников для карточек");
                return;
            }
            toast("ok", `Карточки собраны: ${pdf.pageCount}. Запись PDF через jspdf ещё не подключена.`);
        }}>
        Скачать карточки участников (PDF)
      </button>
      <button type="button" className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500" disabled={!ready} onClick={() => {
            const book = prepareTournamentGridXlsx(cards());
            if (book.rows.length === 0) {
                toast("err", "Сетка турнира пуста");
                return;
            }
            toast("ok", `Сетка собрана: ${book.rows.length} строк. Запись Excel через xlsx ещё не подключена.`);
        }}>
        Скачать сетку турнира (Excel)
      </button>
    </div>);
}
