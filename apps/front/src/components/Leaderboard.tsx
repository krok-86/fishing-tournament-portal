import { useEffect, useState } from "react";
import {
  QUALIFYING_PERIOD_COUNT,
  QUALIFYING_PERIODS,
  type LeaderboardEntry,
  type PeriodIndex,
  type PeriodPhase,
  type PeriodResult,
} from "../../../../packages/shared/src/types.ts";
import { useMatchStore } from "../store.ts";
import { toast } from "../toast.ts";
import { PlayoffBracket } from "./PlayoffBracket.tsx";

function periodStatusText(period: PeriodIndex, phase: PeriodPhase): string {
  if (phase === "fishing") return `Идёт ловля периода ${period}`;
  if (phase === "closed") return `Период ${period} завершён`;
  return `Ожидание старта периода ${period}`;
}

function nextPeriodAction(
  period: PeriodIndex,
  phase: PeriodPhase,
): { period: PeriodIndex; phase: PeriodPhase; label: string } | null {
  if (phase === "waiting") {
    return { period, phase: "fishing", label: `Запустить период ${period}` };
  }
  if (phase === "fishing") {
    return {
      period,
      phase: "closed",
      label:
        period < QUALIFYING_PERIOD_COUNT
          ? `Завершить период ${period} и открыть период ${period + 1}`
          : `Завершить период ${period}`,
    };
  }
  if (period >= QUALIFYING_PERIOD_COUNT) return null;
  const next = (period + 1) as PeriodIndex;
  return { period: next, phase: "fishing", label: `Запустить период ${next}` };
}

const PLAYOFF_PLACES = 8;
const PERIODS: readonly PeriodIndex[] = QUALIFYING_PERIODS;
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
  const phase = useMatchStore((state) => state.periodPhase);
  const signalPeriod = useMatchStore((state) => state.signalPeriod);
  const signalSaving = useMatchStore((state) => state.signalSaving);
  const participants = useMatchStore((state) => state.participants);
  const [edit, setEdit] = useState<{ slotId: string; period: PeriodIndex } | null>(null);
  const ghostIds = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
  const editing = edit ? rows.find((entry) => entry.slotId === edit.slotId) ?? null : null;

  useEffect(() => {
    void loadLeaderboard().then(() => {
      const message = useMatchStore.getState().error;
      if (message) toast("err", message);
    });
  }, [loadLeaderboard]);

  const periodAction = playoffFormed ? null : nextPeriodAction(activePeriod, phase);

  return (
    <section className="mt-4 min-w-0 flex-1">
      {tournamentOpened && !playoffFormed && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3">
          <p className="min-w-0 text-lg leading-tight font-black sm:text-xl">Статус: {periodStatusText(activePeriod, phase)}</p>
          {periodAction && (
            <button
              type="button"
              className="h-12 shrink-0 rounded-xl bg-amber-400 px-4 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
              disabled={signalSaving}
              onClick={() => {
                const action = periodAction;
                void signalPeriod(action.period, action.phase).then((ok) => {
                  if (ok) toast("ok", periodStatusText(action.period, action.phase));
                  else toast("err", useMatchStore.getState().error ?? "Не удалось записать сигнал периода");
                });
              }}
            >
              {signalSaving ? "Записываем…" : periodAction.label}
            </button>
          )}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black tracking-tight sm:text-2xl">Таблица лидеров</h2>
          <p className="text-xs text-slate-400 sm:text-sm">
            PAL Trout: победа 4, ничья 2, поражение с рыбой 1, ноль поимок 0. Нажмите ячейку периода, чтобы поправить поимки.
          </p>
        </div>
        <p className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[11px] font-bold tracking-wide text-amber-100 uppercase">
          Топ-{PLAYOFF_PLACES} в плей-офф
        </p>
      </div>
      {pendingCount > 0 && (
        <p className="mb-3 text-xs font-semibold text-cyan-200">Учтены поимки текущего периода до подтверждения.</p>
      )}
      {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 shadow-xl shadow-black/30 lg:rounded-3xl">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead className="bg-slate-900 text-[10px] tracking-wide text-slate-400 uppercase sm:text-xs">
            <tr>
              <th className="hidden w-14 px-2 py-3 font-semibold md:table-cell md:w-20">Место</th>
              <th className="px-3 py-3 font-semibold">Имя</th>
              {PERIODS.map((period) => (
                <th
                  key={period}
                  className={`px-1 py-3 text-center font-semibold whitespace-nowrap ${
                    period === activePeriod ? "text-cyan-200" : ""
                  }`}
                >
                  П{period}
                </th>
              ))}
              <th className="w-16 px-2 py-3 text-right font-semibold whitespace-nowrap md:w-24">Всего рыб</th>
              <th className="w-14 px-3 py-3 text-right font-semibold md:w-20">Очки</th>
            </tr>
          </thead>
          <tbody>
            {!ready && (
              <tr>
                <td className="px-4 py-6 text-sm text-slate-400" colSpan={COLUMN_COUNT}>
                  Считаем места…
                </td>
              </tr>
            )}
            {ready && !error && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-slate-400" colSpan={COLUMN_COUNT}>
                  В логе событий пока нет участников.
                </td>
              </tr>
            )}
            {rows.map((entry) => (
              <LeaderboardRow
                key={entry.slotId}
                entry={entry}
                activePeriod={activePeriod}
                editable={tournamentOpened && !ghostIds.has(entry.slotId)}
                onEdit={(period) => setEdit({ slotId: entry.slotId, period })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {tournamentOpened && !playoffFormed && (
        <div className="mt-4">
          {eighthPeriodClosed ? (
            <button
              type="button"
              className="h-14 w-full rounded-2xl bg-amber-400 text-base font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
              disabled={playoffSaving}
              onClick={() => {
                void formPlayoff().then((ok) => {
                  if (ok) toast("ok", "Плей-офф сформирован");
                  else toast("err", useMatchStore.getState().playoffError ?? "Не удалось сформировать плей-офф");
                });
              }}
            >
              {playoffSaving ? "Собираем сетку..." : "Сформировать Плей-офф"}
            </button>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              Кнопка «Сформировать Плей-офф» появится после закрытия 8-го периода.
            </p>
          )}
          {playoffError && <p className="mt-2 text-sm text-rose-300">{playoffError}</p>}
        </div>
      )}
      <PlayoffBracket />
      {editing && edit && (
        <PeriodScoreDialog
          key={`${edit.slotId}-${edit.period}`}
          entry={editing}
          period={edit.period}
          onClose={() => setEdit(null)}
        />
      )}
    </section>
  );
}

function LeaderboardRow({
  entry,
  activePeriod,
  editable,
  onEdit,
}: {
  entry: LeaderboardEntry;
  activePeriod: PeriodIndex;
  editable: boolean;
  onEdit: (period: PeriodIndex) => void;
}) {
  const blank = entry.fishCount === 0 && entry.periods.some((cell) => cell.played);
  const playoff = entry.place <= PLAYOFF_PLACES;

  return (
    <tr className={`${rowTone(entry.place)} ${blank ? "opacity-45" : ""}`}>
      <td className="hidden px-2 py-3 md:table-cell">
        <span className="inline-flex items-center gap-1 text-base font-black tabular-nums sm:text-lg">
          {playoff && <Trophy place={entry.place} />}
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
        return (
          <td
            key={period}
            className={`px-1 py-2 text-center text-xs font-semibold tabular-nums whitespace-nowrap ${
              period === activePeriod ? "bg-cyan-300/10 text-cyan-50" : ""
            }`}
          >
            {editable ? (
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg px-1 font-semibold text-inherit"
                aria-label={`Период ${period}, ${entry.displayName}, изменить поимки`}
                onClick={() => onEdit(period)}
              >
                {formatPeriod(cell)}
              </button>
            ) : (
              formatPeriod(cell)
            )}
          </td>
        );
      })}
      <td className="px-2 py-3 text-right font-semibold tabular-nums sm:text-base">{entry.fishCount}</td>
      <td className="px-3 py-3 text-right text-lg font-black tabular-nums sm:text-xl">{entry.points}</td>
    </tr>
  );
}

function PeriodScoreDialog({
  entry,
  period,
  onClose,
}: {
  entry: LeaderboardEntry;
  period: PeriodIndex;
  onClose: () => void;
}) {
  const cell = entry.periods.find((item) => item.period === period);
  const grid = useMatchStore((state) => state.grid);
  const participants = useMatchStore((state) => state.participants);
  const correctPeriodFish = useMatchStore((state) => state.correctPeriodFish);
  const [fish, setFish] = useState(cell?.played ? cell.fish : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slot = grid.find((item) => item.slotId === entry.slotId && item.round === 1 && item.period === period);
  const opponent = slot?.opponentSlotId
    ? participants.find((participant) => participant.slotId === slot.opponentSlotId)
    : undefined;
  const lone = !opponent || opponent.ghost;

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const message = await correctPeriodFish(entry.slotId, period, fish);
    setSaving(false);
    if (message) {
      setError(message);
      toast("err", message);
      return;
    }
    toast("ok", `Период ${period}: поимки сохранены`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/80 p-3 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="period-score-title"
        className="w-full max-w-md rounded-3xl bg-slate-900 p-4 shadow-2xl"
      >
        <p className="text-[11px] font-bold tracking-[0.16em] text-cyan-200 uppercase">Период {period}</p>
        <h2 id="period-score-title" className="mt-1 text-xl font-black">
          №{entry.bibNumber}. {entry.displayName}
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {lone
            ? "Одиночка: очки за период посчитаются по поимкам ближайшего соседа по сектору."
            : "Очки дуэли пересчитаются после сохранения."}
        </p>
        <div className="mt-4 grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2">
          <button
            type="button"
            className="h-16 rounded-2xl bg-rose-500 text-lg font-black text-white disabled:opacity-40"
            disabled={saving || fish === 0}
            onClick={() => setFish((count) => Math.max(0, count - 1))}
          >
            −
          </button>
          <input
            className="h-16 w-full rounded-2xl border border-white/10 bg-slate-950 text-center text-3xl font-black text-white outline-none focus:border-cyan-300"
            inputMode="numeric"
            aria-label="Поимки за период"
            value={String(fish)}
            disabled={saving}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              setFish(digits.length === 0 ? 0 : Math.min(9999, Number(digits)));
            }}
          />
          <button
            type="button"
            className="h-16 rounded-2xl bg-emerald-400 text-lg font-black text-slate-950 disabled:opacity-40"
            disabled={saving || fish >= 9999}
            onClick={() => setFish((count) => Math.min(9999, count + 1))}
          >
            +
          </button>
        </div>
        {error && <p className="mt-3 text-center text-sm text-rose-300">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="h-14 rounded-2xl bg-slate-800 text-sm font-black text-white"
            disabled={saving}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="h-14 rounded-2xl bg-amber-400 text-sm font-black text-slate-950 disabled:opacity-40"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Пишем..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatPeriod(cell: PeriodResult | undefined): string {
  if (!cell?.played) return "—";
  return `${cell.points} (${cell.fish})`;
}

function Trophy({ place }: { place: number }) {
  const color = place === 1 ? "#fcd34d" : place === 2 ? "#e2e8f0" : place === 3 ? "#fdba74" : "#67e8f9";
  return (
    <svg className="size-4 shrink-0 sm:size-5" viewBox="0 0 16 16" aria-hidden="true">
      <path fill={color} d="M4 1.5h8v2.2c0 2.2-1.5 4-3.2 4.5.2.8.8 1.4 1.7 1.6V11H5.5V9.8c.9-.2 1.5-.8 1.7-1.6C5.5 7.7 4 5.9 4 3.7V1.5Z" />
      <path fill={color} d="M3.2 2.2H1.5c.2 1.8 1.2 3 2.6 3.4-.3-.7-.5-1.4-.6-2.2h-.3V2.2Zm9.6 0h1.7c-.2 1.8-1.2 3-2.6 3.4.3-.7.5-1.4.6-2.2h.3V2.2ZM6 12.2h4v1.1H6v-1.1Zm-1 1.6h6v1.1H5v-1.1Z" />
    </svg>
  );
}

function rowTone(place: number): string {
  if (place === 1) return "bg-gradient-to-r from-amber-300/30 via-amber-200/10 to-transparent text-amber-50 shadow-[inset_3px_0_0_#fcd34d]";
  if (place === 2) return "bg-gradient-to-r from-slate-200/25 via-slate-200/10 to-transparent text-slate-50 shadow-[inset_3px_0_0_#e2e8f0]";
  if (place === 3) return "bg-gradient-to-r from-orange-400/25 via-orange-300/10 to-transparent text-orange-50 shadow-[inset_3px_0_0_#fdba74]";
  if (place <= PLAYOFF_PLACES) return "bg-gradient-to-r from-cyan-300/20 via-cyan-200/5 to-transparent text-cyan-50 shadow-[inset_3px_0_0_#67e8f9]";
  return "border-t border-white/5 bg-slate-950 text-slate-200";
}
