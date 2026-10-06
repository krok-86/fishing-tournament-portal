import { useEffect } from "react";
import { QUALIFYING_PERIODS } from "../../../../packages/shared/src/types.ts";
import { useMatchStore } from "../store.ts";
import { PlayoffBracket } from "./PlayoffBracket.tsx";
import { QrIntake } from "./QrIntake.tsx";
const PLAYOFF_PLACES = 8;
const PERIODS = QUALIFYING_PERIODS;
const COLUMN_COUNT = 4 + PERIODS.length;
export function Leaderboard() {
    const rows = useMatchStore((state) => state.leaderboard);
    const ready = useMatchStore((state) => state.leaderboardReady);
    const error = useMatchStore((state) => state.error);
    const pendingCount = useMatchStore((state) => state.pending.length);
    const activePeriod = useMatchStore((state) => state.period);
    const loadLeaderboard = useMatchStore((state) => state.loadLeaderboard);
    const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
    const eighthPeriodClosed = useMatchStore((state) => state.eighthPeriodClosed);
    const playoffFormed = useMatchStore((state) => state.playoff.formed);
    const playoffSaving = useMatchStore((state) => state.playoffSaving);
    const playoffError = useMatchStore((state) => state.playoffError);
    const formPlayoff = useMatchStore((state) => state.formPlayoff);
    useEffect(() => {
        void loadLeaderboard();
    }, [loadLeaderboard]);
    return (<section className="mt-4 min-w-0 flex-1">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black tracking-tight sm:text-2xl">Таблица лидеров</h2>
          <p className="text-xs text-slate-400 sm:text-sm">
            PAL Trout: победа 4, ничья 2, поражение с рыбой 1, ноль поимок 0. В ячейке периода — очки и рыбы.
          </p>
        </div>
        <p className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[11px] font-bold tracking-wide text-amber-100 uppercase">
          Топ-{PLAYOFF_PLACES} в плей-офф
        </p>
      </div>
      <QrIntake />
      {pendingCount > 0 && (<p className="mb-3 text-xs font-semibold text-cyan-200">Учтены поимки текущего периода до подтверждения.</p>)}
      {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 shadow-xl shadow-black/30 lg:rounded-3xl">
        <table className="w-full min-w-0 border-collapse text-left md:min-w-[960px]">
          <thead className="bg-slate-900 text-[10px] tracking-wide text-slate-400 uppercase sm:text-xs">
            <tr>
              <th className="hidden w-14 px-2 py-3 font-semibold md:table-cell md:w-20">Место</th>
              <th className="px-3 py-3 font-semibold">Имя</th>
              {PERIODS.map((period) => (<th key={period} className={`hidden px-1 py-3 text-center font-semibold whitespace-nowrap md:table-cell ${period === activePeriod ? "text-cyan-200" : ""}`}>
                  П{period}
                </th>))}
              <th className="w-16 px-2 py-3 text-right font-semibold whitespace-nowrap md:w-24">Всего рыб</th>
              <th className="w-14 px-3 py-3 text-right font-semibold md:w-20">Очки</th>
            </tr>
          </thead>
          <tbody>
            {!ready && (<tr>
                <td className="px-4 py-6 text-sm text-slate-400" colSpan={COLUMN_COUNT}>
                  Считаем места…
                </td>
              </tr>)}
            {ready && !error && rows.length === 0 && (<tr>
                <td className="px-4 py-6 text-sm text-slate-400" colSpan={COLUMN_COUNT}>
                  В логе событий пока нет участников.
                </td>
              </tr>)}
            {rows.map((entry) => (<LeaderboardRow key={entry.slotId} entry={entry} activePeriod={activePeriod}/>))}
          </tbody>
        </table>
      </div>

      {tournamentOpened && !playoffFormed && (<div className="mt-4">
          {eighthPeriodClosed ? (<button type="button" className="h-14 w-full rounded-2xl bg-amber-400 text-base font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={playoffSaving} onClick={() => void formPlayoff()}>
              {playoffSaving ? "Собираем сетку..." : "Сформировать Плей-офф"}
            </button>) : (<p className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              Кнопка «Сформировать Плей-офф» появится после закрытия 8-го периода.
            </p>)}
          {playoffError && <p className="mt-2 text-sm text-rose-300">{playoffError}</p>}
        </div>)}
      <PlayoffBracket />
    </section>);
}
function LeaderboardRow({ entry, activePeriod }) {
    const blank = entry.fishCount === 0 && entry.periods.some((cell) => cell.played);
    const playoff = entry.place <= PLAYOFF_PLACES;
    return (<tr className={`${rowTone(entry.place)} ${blank ? "opacity-45" : ""}`}>
      <td className="hidden px-2 py-3 md:table-cell">
        <span className="inline-flex items-center gap-1 text-base font-black tabular-nums sm:text-lg">
          {playoff && <Trophy place={entry.place}/>}
          {entry.place}
        </span>
      </td>
      <td className="min-w-0 px-3 py-3">
        <p className="truncate font-medium sm:text-base">
          <span className="md:hidden">{entry.place}. </span>
          {entry.displayName}
        </p>
      </td>
      {PERIODS.map((period) => {
            const cell = entry.periods.find((item) => item.period === period);
            return (<td key={period} className={`hidden px-1 py-3 text-center text-xs font-semibold tabular-nums whitespace-nowrap md:table-cell ${period === activePeriod ? "bg-cyan-300/10 text-cyan-50" : ""}`}>
            {formatPeriod(cell)}
          </td>);
        })}
      <td className="px-2 py-3 text-right font-semibold tabular-nums sm:text-base">{entry.fishCount}</td>
      <td className="px-3 py-3 text-right text-lg font-black tabular-nums sm:text-xl">{entry.points}</td>
    </tr>);
}
function formatPeriod(cell) {
    if (!cell?.played)
        return "—";
    return `${cell.points} (${cell.fish})`;
}
function Trophy({ place }) {
    const color = place === 1 ? "#fcd34d" : place === 2 ? "#e2e8f0" : place === 3 ? "#fdba74" : "#67e8f9";
    return (<svg className="size-4 shrink-0 sm:size-5" viewBox="0 0 16 16" aria-hidden="true">
      <path fill={color} d="M4 1.5h8v2.2c0 2.2-1.5 4-3.2 4.5.2.8.8 1.4 1.7 1.6V11H5.5V9.8c.9-.2 1.5-.8 1.7-1.6C5.5 7.7 4 5.9 4 3.7V1.5Z"/>
      <path fill={color} d="M3.2 2.2H1.5c.2 1.8 1.2 3 2.6 3.4-.3-.7-.5-1.4-.6-2.2h-.3V2.2Zm9.6 0h1.7c-.2 1.8-1.2 3-2.6 3.4.3-.7.5-1.4.6-2.2h.3V2.2ZM6 12.2h4v1.1H6v-1.1Zm-1 1.6h6v1.1H5v-1.1Z"/>
    </svg>);
}
function rowTone(place) {
    if (place === 1)
        return "bg-gradient-to-r from-amber-300/30 via-amber-200/10 to-transparent text-amber-50 shadow-[inset_3px_0_0_#fcd34d]";
    if (place === 2)
        return "bg-gradient-to-r from-slate-200/25 via-slate-200/10 to-transparent text-slate-50 shadow-[inset_3px_0_0_#e2e8f0]";
    if (place === 3)
        return "bg-gradient-to-r from-orange-400/25 via-orange-300/10 to-transparent text-orange-50 shadow-[inset_3px_0_0_#fdba74]";
    if (place <= PLAYOFF_PLACES)
        return "bg-gradient-to-r from-cyan-300/20 via-cyan-200/5 to-transparent text-cyan-50 shadow-[inset_3px_0_0_#67e8f9]";
    return "border-t border-white/5 bg-slate-950 text-slate-200";
}
