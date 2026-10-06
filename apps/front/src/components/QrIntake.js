import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Html5Qrcode } from "html5-qrcode";
import { useMatchStore } from "../store.ts";
export function QrIntake() {
    const importAthleteResults = useMatchStore((state) => state.importAthleteResults);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [cameraNote, setCameraNote] = useState("Включаем камеру…");
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const lastRef = useRef(null);
    const scannerRef = useRef(null);
    const sessionRef = useRef(0);
    const acceptRef = useRef(() => undefined);
    async function accept(raw) {
        const text = raw.trim();
        if (!text || busyRef.current)
            return;
        const now = Date.now();
        if (lastRef.current && lastRef.current.text === text && now - lastRef.current.at < 2500)
            return;
        lastRef.current = { text, at: now };
        busyRef.current = true;
        setBusy(true);
        setStatus(null);
        const result = await importAthleteResults(text);
        busyRef.current = false;
        setBusy(false);
        if (result.ok) {
            setDraft("");
            setStatus({
                tone: "ok",
                text: result.packet.cup
                    ? `Игрок №${result.packet.bibNumber} принят. ${result.packet.cup}`
                    : `Игрок №${result.packet.bibNumber} принят. Рыб: ${result.packet.fish}. Периодов: ${result.packet.periods}. Таблица пересчитана.`,
            });
            return;
        }
        setStatus({ tone: "err", text: result.error });
    }
    useEffect(() => {
        acceptRef.current = (raw) => {
            void accept(raw);
        };
    });
    async function stopScanner() {
        const scanner = scannerRef.current;
        scannerRef.current = null;
        if (!scanner)
            return;
        try {
            if (scanner.isScanning)
                await scanner.stop();
            scanner.clear();
        }
        catch {
            // Камера уже остановлена.
        }
    }
    async function startScanner(session) {
        await stopScanner();
        if (sessionRef.current !== session)
            return;
        const scanner = new Html5Qrcode("player-qr-reader", { verbose: false });
        scannerRef.current = scanner;
        const config = { fps: 8, qrbox: { width: 220, height: 220 } };
        const onCode = (text) => {
            acceptRef.current(text);
        };
        try {
            await scanner.start({ facingMode: "environment" }, config, onCode, () => undefined);
        }
        catch {
            if (sessionRef.current !== session)
                return;
            try {
                scanner.clear();
            }
            catch {
                // Повтор после неудачной задней камеры.
            }
            try {
                await scanner.start({ facingMode: "user" }, config, onCode, () => undefined);
            }
            catch {
                if (sessionRef.current === session)
                    setCameraNote("Камера недоступна. Вставьте строку QR ниже.");
                return;
            }
        }
        if (sessionRef.current !== session) {
            await stopScanner();
            return;
        }
        setCameraNote("Наведите камеру на QR-код игрока.");
    }
    useEffect(() => {
        return () => {
            const scanner = scannerRef.current;
            scannerRef.current = null;
            if (scanner?.isScanning)
                void scanner.stop().catch(() => undefined);
        };
    }, []);
    function toggle() {
        sessionRef.current += 1;
        if (open) {
            setOpen(false);
            void stopScanner();
            return;
        }
        const session = sessionRef.current;
        setCameraNote("Включаем камеру…");
        flushSync(() => setOpen(true));
        void startScanner(session);
    }
    return (<div className="mb-3">
      <button type="button" className="min-h-16 w-full rounded-2xl bg-white px-3 py-3 text-base leading-tight font-black text-slate-950" aria-expanded={open} onClick={toggle}>
        {open ? "Закрыть сканер" : "Сканировать QR-код игрока"}
      </button>
      <div className={open ? "mt-3 rounded-3xl border border-white/10 bg-slate-900 p-4" : "hidden"}>
        <p className="text-sm font-semibold text-slate-300">{cameraNote}</p>
        <div id="player-qr-reader" className="mt-3 overflow-hidden rounded-2xl bg-black"/>
        <form className="mt-4" onSubmit={(event) => {
            event.preventDefault();
            void accept(draft);
        }}>
          <label className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase" htmlFor="qr-paste">
            Строка QR для проверки без камеры
          </label>
          <textarea id="qr-paste" className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300" value={draft} placeholder="FTP1|4|QF|1=3" onChange={(event) => setDraft(event.target.value)}/>
          <button type="submit" className="mt-3 h-14 w-full rounded-2xl bg-cyan-300 text-base font-black text-slate-950 disabled:opacity-40" disabled={busy || draft.trim().length === 0}>
            {busy ? "Записываем…" : "Принять строку"}
          </button>
        </form>
        {status && (<p className={`mt-3 text-sm font-semibold ${status.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`} aria-live="polite">
            {status.text}
          </p>)}
      </div>
    </div>);
}
