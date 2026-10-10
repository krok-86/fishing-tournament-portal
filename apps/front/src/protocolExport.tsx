import { isGhostOpponent } from "../../../packages/shared/src/calculator.ts";
import {
  QUALIFYING_PERIODS,
  type GridSlot,
  type LeaderboardEntry,
  type PeriodIndex,
  type PeriodPoints,
} from "../../../packages/shared/src/types.ts";
import { periodSeat, useMatchStore, type RegisteredParticipant } from "./store.ts";
import { toast } from "./toast.ts";

/** «[№3] Бакладоров К.» — номер жеребьёвки и ФИО. */
export function formatDrawName(bibNumber: number, displayName: string): string {
  return `[№${bibNumber}] ${displayName}`;
}

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

export function facingFish(
  leaderboard: readonly LeaderboardEntry[],
  slotId: string,
  period: PeriodIndex,
  scoringOpponentSlotId: string | null,
): { ownFish: number; opponentFish: number; points: PeriodPoints; played: boolean } {
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

export function buildParticipantCards(
  participants: readonly RegisteredParticipant[],
  grid: readonly GridSlot[],
  leaderboard: readonly LeaderboardEntry[],
): ParticipantCard[] {
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
        const opponentBib =
          bergerId && !isGhostOpponent(bergerId) ? (bibOf.get(bergerId) ?? null) : null;
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

export function prepareParticipantCardsPdf(cards: readonly ParticipantCard[]): PdfCardStub {
  return {
    library: "jspdf",
    integrated: false,
    filename: "kartochki-uchastnikov.pdf",
    pageCount: cards.length,
    cards: cards.map((card) => ({ ...card, periods: card.periods.map((period) => ({ ...period })) })),
  };
}

export function prepareTournamentGridXlsx(cards: readonly ParticipantCard[]): XlsxGridStub {
  const rows: TournamentGridRow[] = cards.flatMap((card) =>
    card.periods.map((period) => ({
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
    })),
  );
  return {
    library: "xlsx",
    integrated: false,
    filename: "setka-turnira.xlsx",
    sheetName: "Сетка",
    rows,
  };
}

export function ProtocolExportButtons({ grid }: { grid?: readonly GridSlot[] }) {
  const participants = useMatchStore((state) => state.participants);
  const leaderboard = useMatchStore((state) => state.leaderboard);
  const storeGrid = useMatchStore((state) => state.grid);
  const draw = grid ?? storeGrid;
  const ready = participants.some((participant) => !participant.ghost) && draw.length > 0;

  function cards(): ParticipantCard[] {
    return buildParticipantCards(participants, draw, leaderboard);
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500"
        disabled={!ready}
        onClick={() => {
          const pdf = prepareParticipantCardsPdf(cards());
          if (pdf.pageCount === 0) {
            toast("err", "Нет участников для карточек");
            return;
          }
          toast("ok", `Карточки собраны: ${pdf.pageCount}. Запись PDF через jspdf ещё не подключена.`);
        }}
      >
        Скачать карточки участников (PDF)
      </button>
      <button
        type="button"
        className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500"
        disabled={!ready}
        onClick={() => {
          const book = prepareTournamentGridXlsx(cards());
          if (book.rows.length === 0) {
            toast("err", "Сетка турнира пуста");
            return;
          }
          toast("ok", `Сетка собрана: ${book.rows.length} строк. Запись Excel через xlsx ещё не подключена.`);
        }}
      >
        Скачать сетку турнира (Excel)
      </button>
    </div>
  );
}
