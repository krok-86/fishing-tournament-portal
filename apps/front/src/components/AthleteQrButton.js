import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QUALIFYING_PERIOD_COUNT } from "../../../../packages/shared/src/types.ts";
import { useMatchStore } from "../store.ts";
import { toast } from "../toast.ts";
export function AthleteQrButton() {
    const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
    const athleteSlotId = useMatchStore((state) => state.athleteSlotId);
    const selfSlotId = useMatchStore((state) => state.selfSlotId);
    const playoffFormed = useMatchStore((state) => state.playoff.formed);
    const qualifyingHandoffReady = useMatchStore((state) => state.qualifyingHandoffReady);
    const qualifyingSavedCount = useMatchStore((state) => state.qualifyingSavedCount);
    const cupHandoffReady = useMatchStore((state) => state.cupHandoffReady);
    const saving = useMatchStore((state) => state.saving);
    const exportAthleteResults = useMatchStore((state) => state.exportAthleteResults);
    const [packet, setPacket] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    if (!tournamentOpened)
        return null;
    const cupMode = playoffFormed;
    const selected = cupMode ? selfSlotId.length > 0 : athleteSlotId.length > 0;
    const ready = cupMode ? cupHandoffReady : qualifyingHandoffReady;
    if (!selected)
        return null;
    async function generate() {
        const live = useMatchStore.getState();
        const qualifyingComplete = live.qualifyingHandoffReady && live.qualifyingSavedCount === QUALIFYING_PERIOD_COUNT;
        if (!live.playoff.formed && !qualifyingComplete) {
            toast("err", "Сначала подтвердите все 8 периодов");
            return;
        }
        setBusy(true);
        setError(null);
        setCopied(false);
        const result = await exportAthleteResults();
        setBusy(false);
        if (!result.ok) {
            setPacket(null);
            setError(result.error);
            toast("err", result.error);
            return;
        }
        setPacket(result.packet);
        toast("ok", cupMode ? "QR-код матча готов" : "QR-код результатов готов");
    }
    async function copyPayload() {
        if (!packet)
            return;
        try {
            await navigator.clipboard.writeText(packet.payload);
            setCopied(true);
            toast("ok", "Строка скопирована");
        }
        catch {
            setCopied(false);
            toast("err", "Не удалось скопировать строку");
        }
    }
    if (cupMode && !ready) {
        return (<p className="mt-3 text-center text-sm font-semibold text-slate-300">
        QR-код матча появится сразу после сохранения дуэли.
      </p>);
    }
    const qualifyingComplete = qualifyingHandoffReady && qualifyingSavedCount === QUALIFYING_PERIOD_COUNT;
    const resultsLocked = !cupMode && !qualifyingComplete;
    return (<>
      <button type="button" className="mt-3 min-h-20 w-full rounded-2xl bg-white px-3 py-3 text-lg leading-tight font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={saving || busy || resultsLocked} aria-disabled={saving || busy || resultsLocked} onClick={() => void generate()}>
        {busy ? "Собираем результаты…" : cupMode ? "Сгенерировать QR-код матча" : "Сгенерировать QR-код результатов"}
      </button>
      {resultsLocked && (<p className="mt-2 text-center text-sm font-semibold text-slate-300">
          Кнопка включится, когда в телефоне подтверждены все 8 периодов. Уже сохранено: {qualifyingSavedCount} из 8.
        </p>)}
      {error && <p className="mt-2 text-center text-sm text-rose-300">{error}</p>}
      {packet && (<div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-950/80 p-3 sm:items-center" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="athlete-qr-title" className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-slate-900 p-4 shadow-2xl">
            <h2 id="athlete-qr-title" className="text-xl font-black">
              Игрок №{packet.bibNumber}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {packet.displayName}. Покажите код организатору. Рыб: {packet.fish}.{" "}
              {packet.playoffCells.length > 0 ? `Матчей: ${packet.playoffCells.length}.` : `Периодов: ${packet.periods}.`}
              {packet.markLabel ? ` В коде период: ${packet.markLabel}.` : ""}
            </p>
            <div className="mx-auto mt-4 w-fit rounded-3xl bg-white p-3">
              <QRCodeSVG value={packet.payload} size={260} level="H" marginSize={4} bgColor="#ffffff" fgColor="#020617" title={`Результаты игрока №${packet.bibNumber}`}/>
            </div>
            <ul className="mt-4 grid gap-1 text-sm font-semibold text-cyan-50">
              {(packet.playoffCells.length > 0 ? packet.playoffCells : packet.cells).map((cell) => (<li key={"stage" in cell ? `${cell.stage}.${cell.pair}` : `${cell.round}.${cell.period}`}>
                  {cellLabel(cell)} — {cell.fish} {fishWord(cell.fish)}
                </li>))}
            </ul>
            <label className="mt-4 block text-xs font-bold tracking-wide text-slate-400 uppercase" htmlFor="athlete-qr-payload">
              Строка для переноса
            </label>
            <textarea id="athlete-qr-payload" className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-cyan-100 outline-none" readOnly rows={3} value={packet.payload} onFocus={(event) => event.currentTarget.select()}/>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="h-12 rounded-xl bg-cyan-300 text-sm font-black text-slate-950" onClick={() => void copyPayload()}>
                {copied ? "Скопировано" : "Скопировать"}
              </button>
              <button type="button" className="h-12 rounded-xl bg-slate-800 text-sm font-black text-white" onClick={() => setPacket(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>)}
    </>);
}
function cellLabel(cell) {
    if ("stage" in cell) {
        const stage = cell.stage === "QF" ? "Четвертьфинал" : cell.stage === "SF" ? "Полуфинал" : "Финал";
        return `${stage}, пара ${cell.pair}`;
    }
    if (cell.round === 1)
        return `Период ${cell.period}`;
    return `Тур ${cell.round}, период ${cell.period}`;
}
function fishWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11)
        return "рыба";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
        return "рыбы";
    return "рыб";
}
