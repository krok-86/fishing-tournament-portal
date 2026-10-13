import { useEffect, useState } from "react";
import { isGhostOpponent, pointsAgainst } from "../../../../packages/shared/src/calculator.ts";
import { QUALIFYING_PERIOD_COUNT, QUALIFYING_PERIODS, } from "../../../../packages/shared/src/types.ts";
import { fetchMatchSync } from "../matchSync.ts";
import { facingFish, formatDrawName, ProtocolExportButtons } from "../protocolExport.tsx";
import { periodSeat, useMatchStore } from "../store.ts";
import { toast } from "../toast.ts";
import { PlayoffBracket } from "./PlayoffBracket.tsx";
function periodStatusText(period, phase) {
    if (phase === "fishing")
        return `Идёт ловля периода ${period}`;
    if (phase === "closed")
        return `Период ${period} завершён`;
    return `Ожидание старта периода ${period}`;
}
function nextPeriodAction(period, phase) {
    if (phase === "waiting") {
        return { period, phase: "fishing", label: `Запустить период ${period}` };
    }
    if (phase === "fishing") {
        return {
            period,
            phase: "closed",
            label: period < QUALIFYING_PERIOD_COUNT
                ? `Завершить период ${period} и открыть период ${period + 1}`
                : `Завершить период ${period}`,
        };
    }
    if (period >= QUALIFYING_PERIOD_COUNT)
        return null;
    const next = (period + 1);
    return { period: next, phase: "fishing", label: `Запустить период ${next}` };
}
const PLAYOFF_PLACES = 8;
const PERIODS = QUALIFYING_PERIODS;
const COLUMN_COUNT = 4 + PERIODS.length;
const FISH_CAP = 9999;
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
    const phase = useMatchStore((state) => state.periodPhase);
    const signalPeriod = useMatchStore((state) => state.signalPeriod);
    const signalSaving = useMatchStore((state) => state.signalSaving);
    const participants = useMatchStore((state) => state.participants);
    const duelConflicts = useMatchStore((state) => state.duelConflicts);
    const [edit, setEdit] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [cardSlotId, setCardSlotId] = useState(null);
    const [archiving, setArchiving] = useState(false);
    const [archiveUrl, setArchiveUrl] = useState(null);
    const ghostIds = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
    const editing = edit ? rows.find((entry) => entry.slotId === edit.slotId) ?? null : null;
    const cardEntry = cardSlotId ? rows.find((entry) => entry.slotId === cardSlotId) ?? null : null;
    useEffect(() => {
        void loadLeaderboard().then(() => {
            const message = useMatchStore.getState().error;
            if (message)
                toast("err", message);
        });
    }, [loadLeaderboard]);
    const periodAction = playoffFormed ? null : nextPeriodAction(activePeriod, phase);
    async function refreshOnline() {
        if (refreshing)
            return;
        setRefreshing(true);
        const result = await fetchMatchSync();
        if (!result.ok) {
            setRefreshing(false);
            toast("err", "Не удалось обновить данные. Проверьте сеть.");
            return;
        }
        const applied = await useMatchStore.getState().applyOnlineMatches(result.matches);
        if (!applied) {
            setRefreshing(false);
            toast("err", "Не удалось записать свежие уловы.");
            return;
        }
        await loadLeaderboard();
        setRefreshing(false);
        const message = useMatchStore.getState().error;
        if (message)
            toast("err", message);
        else
            toast("ok", "Данные обновлены");
    }
    return (<section className="mt-4 min-w-0 flex-1">
      {tournamentOpened && !playoffFormed && (<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3">
          <p className="min-w-0 text-lg leading-tight font-black sm:text-xl">Статус: {periodStatusText(activePeriod, phase)}</p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" className="h-12 rounded-xl border border-white/15 bg-slate-800 px-4 text-sm font-black text-white disabled:text-slate-400" disabled={refreshing} onClick={() => void refreshOnline()}>
              {refreshing ? "Обновляем…" : "🔄 Обновить данные"}
            </button>
            {periodAction && (<button type="button" className="h-12 rounded-xl bg-amber-400 px-4 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={signalSaving} onClick={() => {
                    const action = periodAction;
                    void signalPeriod(action.period, action.phase).then((ok) => {
                        if (ok)
                            toast("ok", periodStatusText(action.period, action.phase));
                        else
                            toast("err", useMatchStore.getState().error ?? "Не удалось записать сигнал периода");
                    });
                }}>
                {signalSaving ? "Записываем…" : periodAction.label}
              </button>)}
          </div>
        </div>)}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black tracking-tight sm:text-2xl">Таблица лидеров</h2>
          <p className="text-xs text-slate-400 sm:text-sm">
            Ячейка периода: свои рыбы : рыбы соперника (очки). Имя открывает карточку, ячейка — правку поимок. Оранжевая ячейка — расхождение в дуэли.
          </p>
        </div>
        <p className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[11px] font-bold tracking-wide text-amber-100 uppercase">
          Топ-{PLAYOFF_PLACES} в плей-офф
        </p>
      </div>
      <div className="mb-3">
        <ProtocolExportButtons middle={<button type="button" className="h-12 rounded-2xl border border-white/15 bg-slate-900 px-3 text-sm font-black text-white disabled:text-slate-500" disabled={refreshing} onClick={() => void refreshOnline()}>
            {refreshing ? "Обновляем…" : "🔄 Обновить данные"}
          </button>}/>
      </div>
      {pendingCount > 0 && (<p className="mb-3 text-xs font-semibold text-cyan-200">Учтены поимки текущего периода до подтверждения.</p>)}
      {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 shadow-xl shadow-black/30 lg:rounded-3xl">
        <table className="w-full min-w-[1040px] border-collapse text-left">
          <thead className="bg-slate-900 text-[10px] tracking-wide text-slate-400 uppercase sm:text-xs">
            <tr>
              <th className="hidden w-14 px-2 py-3 font-semibold md:table-cell md:w-20">Место</th>
              <th className="px-3 py-3 font-semibold">Имя</th>
              {PERIODS.map((period) => (<th key={period} className={`px-1 py-3 text-center font-semibold whitespace-nowrap ${period === activePeriod ? "text-cyan-200" : ""}`}>
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
            {rows.map((entry) => (<LeaderboardRow key={entry.slotId} entry={entry} activePeriod={activePeriod} editable={tournamentOpened && !ghostIds.has(entry.slotId)} conflictPeriods={conflictPeriodsFor(duelConflicts, entry.slotId)} onEdit={(period) => setEdit({ slotId: entry.slotId, period })} onOpenCard={() => setCardSlotId(entry.slotId)}/>))}
          </tbody>
        </table>
      </div>

      {tournamentOpened && !playoffFormed && (<div className="mt-4">
          {eighthPeriodClosed ? (<button type="button" className="h-14 w-full rounded-2xl bg-amber-400 text-base font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={playoffSaving} onClick={() => {
                    void formPlayoff().then((ok) => {
                        if (ok)
                            toast("ok", "Плей-офф сформирован");
                        else
                            toast("err", useMatchStore.getState().playoffError ?? "Не удалось сформировать плей-офф");
                    });
                }}>
              {playoffSaving ? "Собираем сетку..." : "Сформировать Плей-офф"}
            </button>) : (<p className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              Кнопка «Сформировать Плей-офф» появится после закрытия 8-го периода.
            </p>)}
          {playoffError && <p className="mt-2 text-sm text-rose-300">{playoffError}</p>}
        </div>)}
      <PlayoffBracket onArchive={() => {
            if (archiving)
                return;
            setArchiving(true);
            void useMatchStore
                .getState()
                .archiveTournament()
                .then((result) => {
                setArchiving(false);
                if (!result.ok) {
                    toast("err", result.error);
                    return;
                }
                setArchiveUrl(new URL(result.path, window.location.origin).href);
                toast("ok", "Турнир записан в архив");
            })
                .catch(() => {
                setArchiving(false);
                toast("err", "Не удалось собрать архив турнира");
            });
        }} archiving={archiving} archiveUrl={archiveUrl}/>
      {editing && edit && (<PeriodScoreDialog key={`${edit.slotId}-${edit.period}`} entry={editing} period={edit.period} rows={rows} participants={participants} onClose={() => setEdit(null)}/>)}
      {cardEntry && (<ParticipantCardDialog key={cardEntry.slotId} entry={cardEntry} rows={rows} participants={participants} editable={tournamentOpened && !ghostIds.has(cardEntry.slotId)} onClose={() => setCardSlotId(null)}/>)}
    </section>);
}
function LeaderboardRow({ entry, activePeriod, editable, conflictPeriods, onEdit, onOpenCard, }) {
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
        <button type="button" className="block max-w-full truncate text-left font-medium text-inherit sm:text-base" onClick={onOpenCard}>
          <span className="md:hidden">{entry.place}. </span>
          {formatDrawName(entry.bibNumber, entry.displayName)}
        </button>
      </td>
      {PERIODS.map((period) => {
            const cell = entry.periods.find((item) => item.period === period);
            const conflict = conflictPeriods.has(period);
            return (<td key={period} className={`px-1 py-2 text-center text-xs font-semibold tabular-nums whitespace-nowrap ${conflict
                    ? "bg-red-700/90 text-white shadow-[inset_0_0_0_2px_#fb923c]"
                    : period === activePeriod
                        ? "bg-cyan-300/10 text-cyan-50"
                        : ""}`}>
            {editable ? (<button type="button" className={`min-h-11 min-w-11 rounded-lg px-1 font-semibold ${conflict ? "bg-orange-500 font-black text-slate-950 ring-2 ring-red-500" : "text-inherit"}`} aria-label={`Период ${period}, ${formatDrawName(entry.bibNumber, entry.displayName)}, ${conflict ? "расхождение, изменить поимки" : "изменить поимки"}`} onClick={() => onEdit(period)}>
                {formatPeriod(cell)}
              </button>) : (formatPeriod(cell))}
          </td>);
        })}
      <td className="px-2 py-3 text-right font-semibold tabular-nums sm:text-base">{entry.fishCount}</td>
      <td className="px-3 py-3 text-right text-lg font-black tabular-nums sm:text-xl">{entry.points}</td>
    </tr>);
}
function PeriodScoreDialog({ entry, period, rows, participants, onClose, }) {
    const grid = useMatchStore((state) => state.grid);
    const correctPeriodFish = useMatchStore((state) => state.correctPeriodFish);
    const seat = periodSeat(grid, participants, entry.slotId, period);
    const opponentId = seat?.opponentSlotId ?? null;
    const opponent = opponentId ? participants.find((participant) => participant.slotId === opponentId) : undefined;
    const lone = seat !== null && isGhostOpponent(seat.bergerOpponentSlotId);
    const initial = facingFish(rows, entry.slotId, period, opponentId);
    const [ownFish, setOwnFish] = useState(initial.ownFish);
    const [opponentFish, setOpponentFish] = useState(initial.opponentFish);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const points = opponentId ? pointsAgainst(ownFish, opponentFish) : null;
    const dispute = useMatchStore((state) => state.duelConflicts.find((item) => item.status === "open" && item.slotId === entry.slotId && item.period === period));
    async function save() {
        if (saving)
            return;
        setSaving(true);
        setError(null);
        const message = await correctPeriodFish(entry.slotId, period, ownFish, opponentId ? opponentFish : 0);
        setSaving(false);
        if (message) {
            setError(message);
            toast("err", message);
            return;
        }
        toast("ok", `Период ${period}: поимки записаны, баллы пересчитаны`);
        onClose();
    }
    return (<div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/80 p-3 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="period-score-title" className="w-full max-w-md rounded-3xl bg-slate-900 p-4 shadow-2xl">
        <p className="text-[11px] font-bold tracking-[0.16em] text-cyan-200 uppercase">
          Период {period}
          {seat?.sectorId ? ` · сектор ${seat.sectorId}` : ""}
          {opponent ? ` · соперник №${opponent.bibNumber}` : ""}
        </p>
        <h2 id="period-score-title" className="mt-1 text-xl font-black">
          {formatDrawName(entry.bibNumber, entry.displayName)}
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {lone
            ? "Одиночка. Поимки соперника — рыба соседа по сектору. Баллы после записи посчитает калькулятор."
            : "Меняются только поимки. Баллы 4, 2, 1 или 0 после записи посчитает калькулятор."}
        </p>
        {dispute && (<p className="mt-3 rounded-2xl bg-orange-500/20 px-3 py-2 text-sm font-bold text-orange-100">
            Расхождение: {dispute.detail}. Утвердите финальный счёт.
          </p>)}
        <div className="mt-4 grid gap-3">
          <FishStepper label="Поимки игрока" value={ownFish} disabled={saving} onChange={setOwnFish}/>
          <FishStepper label="Поимки соперника" value={opponentId ? opponentFish : 0} disabled={saving || !opponentId} onChange={setOpponentFish}/>
          <p className="rounded-2xl bg-slate-950 px-4 py-3 text-center">
            <span className="text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">Баллы дуэли</span>
            <span className="mt-1 block text-4xl font-black tabular-nums">{points === null ? "—" : points}</span>
            <span className="mt-1 block text-sm text-slate-400">
              {ownFish}:{opponentId ? opponentFish : "—"}
            </span>
          </p>
        </div>
        {error && <p className="mt-3 text-center text-sm text-rose-300">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="h-14 rounded-2xl bg-slate-800 text-sm font-black text-white" disabled={saving} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="h-14 rounded-2xl bg-amber-400 text-sm font-black text-slate-950 disabled:opacity-40" disabled={saving} onClick={() => void save()}>
            {saving ? "Пишем..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>);
}
function ParticipantCardDialog({ entry, rows, participants, editable, onClose, }) {
    const grid = useMatchStore((state) => state.grid);
    const correctPeriodFish = useMatchStore((state) => state.correctPeriodFish);
    const [drafts, setDrafts] = useState(() => initialDrafts(rows, participants, grid, entry.slotId));
    const [savingPeriod, setSavingPeriod] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === "Escape" && savingPeriod === null)
                onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, savingPeriod]);
    async function savePeriod(period) {
        if (!editable || savingPeriod !== null)
            return;
        const seat = periodSeat(grid, participants, entry.slotId, period);
        const draft = drafts[period] ?? { own: 0, opponent: 0 };
        setSavingPeriod(period);
        setError(null);
        const message = await correctPeriodFish(entry.slotId, period, draft.own, seat?.opponentSlotId ? draft.opponent : 0);
        setSavingPeriod(null);
        if (message) {
            setError(message);
            toast("err", message);
            return;
        }
        toast("ok", `Период ${period}: поимки записаны, баллы пересчитаны`);
    }
    return (<div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 sm:items-center" role="presentation" onClick={() => {
            if (savingPeriod === null)
                onClose();
        }}>
      <div role="dialog" aria-modal="true" aria-labelledby="participant-card-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-3xl bg-slate-900 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <p className="text-[11px] font-bold tracking-[0.16em] text-cyan-200 uppercase">Карточка участника</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h2 id="participant-card-title" className="text-2xl font-black">
            {formatDrawName(entry.bibNumber, entry.displayName)}
          </h2>
          <button type="button" className="h-11 shrink-0 rounded-xl bg-slate-800 px-4 text-sm font-black text-white" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-300">
          Место {entry.place} · рыб {entry.fishCount} · очков {entry.points}. Поимки правятся здесь, баллы считает калькулятор.
        </p>
        <div className="mt-4 space-y-2 overflow-y-auto pr-1">
          {PERIODS.map((period) => {
            const seat = periodSeat(grid, participants, entry.slotId, period);
            const opponent = seat?.opponentSlotId
                ? participants.find((participant) => participant.slotId === seat.opponentSlotId)
                : undefined;
            const draft = drafts[period] ?? { own: 0, opponent: 0 };
            const stored = facingFish(rows, entry.slotId, period, seat?.opponentSlotId ?? null);
            const dirty = draft.own !== stored.ownFish || (seat?.opponentSlotId ? draft.opponent !== stored.opponentFish : false);
            const points = seat?.opponentSlotId ? pointsAgainst(draft.own, draft.opponent) : stored.played ? stored.points : null;
            const saving = savingPeriod === period;
            return (<article key={period} className="rounded-2xl bg-slate-950 px-3 py-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <CardStat label="Период" value={String(period)}/>
                  <CardStat label="Сектор" value={seat?.sectorId || "—"}/>
                  <CardStat label="Соперник" value={opponent ? `№${opponent.bibNumber}` : "—"}/>
                </div>
                {isGhostOpponent(seat?.bergerOpponentSlotId) && opponent && (<p className="mt-2 text-center text-xs text-slate-400">Одиночка: сравнение с соседом №{opponent.bibNumber}</p>)}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <FishStepper label="Поимки свои" value={draft.own} disabled={!editable || savingPeriod !== null} size="compact" onChange={(own) => setDrafts((current) => ({ ...current, [period]: { ...draft, own } }))}/>
                  <FishStepper label="Поимки соперника" value={seat?.opponentSlotId ? draft.opponent : 0} disabled={!editable || savingPeriod !== null || !seat?.opponentSlotId} size="compact" onChange={(opponentCount) => setDrafts((current) => ({ ...current, [period]: { ...draft, opponent: opponentCount } }))}/>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-200">
                    Баллы: <span className="text-lg font-black tabular-nums">{points === null ? "—" : points}</span>
                    {!stored.played && <span className="ml-2 text-xs font-semibold text-slate-400">период ещё не сыгран</span>}
                  </p>
                  <button type="button" className="h-11 rounded-xl bg-amber-400 px-4 text-sm font-black text-slate-950 disabled:bg-slate-800 disabled:text-slate-500" disabled={!editable || !dirty || savingPeriod !== null} onClick={() => void savePeriod(period)}>
                    {saving ? "Пишем..." : "Записать"}
                  </button>
                </div>
              </article>);
        })}
        </div>
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </div>
    </div>);
}
function initialDrafts(rows, participants, grid, slotId) {
    const drafts = {};
    for (const period of PERIODS) {
        const seat = periodSeat(grid, participants, slotId, period);
        const fish = facingFish(rows, slotId, period, seat?.opponentSlotId ?? null);
        drafts[period] = { own: fish.ownFish, opponent: fish.opponentFish };
    }
    return drafts;
}
function FishStepper({ label, value, disabled, onChange, size = "large", }) {
    const tall = size === "large";
    return (<div>
      <p className="mb-1 text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">{label}</p>
      <div className={`grid items-center gap-2 ${tall ? "grid-cols-[4.5rem_1fr_4.5rem]" : "grid-cols-[3rem_1fr_3rem]"}`}>
        <button type="button" className={`${tall ? "h-16 text-lg" : "h-12 text-base"} rounded-2xl bg-rose-500 font-black text-white disabled:opacity-40`} disabled={disabled || value === 0} aria-label={`${label}: меньше`} onClick={() => onChange(Math.max(0, value - 1))}>
          −
        </button>
        <input className={`${tall ? "h-16 text-3xl" : "h-12 text-xl"} w-full rounded-2xl border border-white/10 bg-slate-950 text-center font-black text-white outline-none focus:border-cyan-300 disabled:opacity-60`} inputMode="numeric" aria-label={label} value={String(value)} disabled={disabled} onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "");
            onChange(digits.length === 0 ? 0 : Math.min(FISH_CAP, Number(digits)));
        }}/>
        <button type="button" className={`${tall ? "h-16 text-lg" : "h-12 text-base"} rounded-2xl bg-emerald-400 font-black text-slate-950 disabled:opacity-40`} disabled={disabled || value >= FISH_CAP} aria-label={`${label}: больше`} onClick={() => onChange(Math.min(FISH_CAP, value + 1))}>
          +
        </button>
      </div>
    </div>);
}
function CardStat({ label, value }) {
    return (<div>
      <p className="text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">{label}</p>
      <p className="text-lg font-black tabular-nums">{value}</p>
    </div>);
}
function conflictPeriodsFor(conflicts, slotId) {
    const periods = new Set();
    for (const item of conflicts) {
        if (item.status !== "open" || item.slotId !== slotId)
            continue;
        const period = item.period;
        if (!PERIODS.includes(period))
            continue;
        periods.add(period);
    }
    return periods;
}
function formatPeriod(cell) {
    if (!cell?.played)
        return "—";
    return `${cell.fish}:${cell.opponentFish} (${cell.points})`;
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
