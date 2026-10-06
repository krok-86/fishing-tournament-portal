import { QRCodeSVG } from "qrcode.react";
import { QUALIFYING_PERIOD_COUNT, type PeriodIndex, type PeriodPhase } from "../../../../packages/shared/src/types.ts";
import { encodePeriodSignal, periodStatusLabel } from "../qrSync.ts";
import { useMatchStore } from "../store.ts";

export function PeriodControl() {
  const period = useMatchStore((state) => state.period);
  const phase = useMatchStore((state) => state.periodPhase);
  const signalPeriod = useMatchStore((state) => state.signalPeriod);
  const signalSaving = useMatchStore((state) => state.signalSaving);
  const playoffFormed = useMatchStore((state) => state.playoff.formed);
  const action = playoffFormed ? null : nextPeriodAction(period, phase);

  if (playoffFormed) return null;

  return (
    <section className="mt-4 max-w-lg rounded-3xl bg-slate-900 px-4 py-4">
      <p className="text-xs font-bold tracking-[0.16em] text-cyan-100/80 uppercase">Сирена периода</p>
      <p className="mt-2 text-2xl leading-tight font-black text-balance">{periodStatusLabel(period, phase)}</p>
      {phase === "closed" && period < QUALIFYING_PERIOD_COUNT && (
        <p className="mt-2 text-sm font-semibold text-amber-100">
          Период {period + 1} открыт. Запустите его, когда дадите старт на водоёме.
        </p>
      )}
      {phase === "closed" && period >= QUALIFYING_PERIOD_COUNT && (
        <p className="mt-2 text-sm font-semibold text-amber-100">Отбор закрыт. Дальше — плей-офф.</p>
      )}
      {action && (
        <button
          type="button"
          className="mt-4 h-14 w-full rounded-2xl bg-amber-400 px-3 text-base leading-tight font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
          disabled={signalSaving}
          onClick={() => void signalPeriod(action.period, action.phase)}
        >
          {signalSaving ? "Записываем…" : action.label}
        </button>
      )}
      <div className="mt-4 flex flex-col items-center">
        <div className="rounded-3xl bg-white p-3">
          <QRCodeSVG
            value={encodePeriodSignal(period, phase)}
            size={180}
            level="M"
            marginSize={4}
            bgColor="#ffffff"
            fgColor="#020617"
            title={periodStatusLabel(period, phase)}
          />
        </div>
        <p className="mt-3 text-center text-xs leading-relaxed text-slate-400">
          Игрок сканирует этот код, когда сдаёт результат или ловит сирену. Внутри — номер активного периода.
        </p>
      </div>
    </section>
  );
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
