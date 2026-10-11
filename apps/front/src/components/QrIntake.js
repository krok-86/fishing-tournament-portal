import { memo, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import { decodeCatchSnapshot } from "../qrSync.ts";
import { playScanBeep, primeScanBeep } from "../scanBeep.ts";
import { useMatchStore } from "../store.ts";
import { toast } from "../toast.ts";
const ATHLETE_PREFIX = "FTP1|";
/** Пауза после последнего символа: внешний сканер допечатывает строку пачкой, затем она уходит сама. */
const FIELD_SETTLE_MS = 100;
const SAME_CODE_MS = 2500;
function compactQr(raw) {
    return raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
}
function readyAthleteQr(raw) {
    const text = compactQr(raw);
    if (!text.startsWith(ATHLETE_PREFIX))
        return null;
    if (!decodeCatchSnapshot(text).ok)
        return null;
    return text;
}
/** Кадр камеры живёт вне перерисовок формы: иначе React снимает video после первого успешного кода. */
const ScannerSurface = memo(function ScannerSurface() {
    return <div id="player-qr-reader" className="mt-3 overflow-hidden rounded-2xl bg-black"/>;
});
export function QrIntake() {
    const importAthleteResults = useMatchStore((state) => state.importAthleteResults);
    const [draft, setDraft] = useState("");
    const [cameraNote, setCameraNote] = useState("Включаем камеру…");
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const lastRef = useRef(null);
    const pendingRef = useRef(null);
    const draftRef = useRef("");
    const fieldRef = useRef(null);
    const fieldTimer = useRef(null);
    const scannerRef = useRef(null);
    const sessionRef = useRef(0);
    const acceptRef = useRef(() => undefined);
    function cancelFieldTimer() {
        if (fieldTimer.current === null)
            return;
        window.clearTimeout(fieldTimer.current);
        fieldTimer.current = null;
    }
    function writeDraft(value) {
        draftRef.current = value;
        setDraft(value);
    }
    function keepCameraLive() {
        const scanner = scannerRef.current;
        if (!scanner)
            return;
        try {
            const state = scanner.getState();
            if (state === Html5QrcodeScannerState.PAUSED) {
                scanner.resume();
                return;
            }
            if (state === Html5QrcodeScannerState.SCANNING)
                return;
        }
        catch {
            return;
        }
        void startScanner(sessionRef.current);
    }
    async function accept(raw, origin) {
        const text = compactQr(raw);
        if (!text)
            return;
        if (busyRef.current) {
            if (lastRef.current?.text !== text)
                pendingRef.current = text;
            return;
        }
        const now = Date.now();
        if (lastRef.current && lastRef.current.text === text && now - lastRef.current.at < SAME_CODE_MS)
            return;
        lastRef.current = { text, at: now };
        cancelFieldTimer();
        busyRef.current = true;
        setBusy(true);
        setStatus(null);
        if (origin === "field")
            writeDraft("");
        let result;
        try {
            result = await importAthleteResults(text);
        }
        catch (error) {
            result = {
                ok: false,
                error: error instanceof Error ? error.message : "Не удалось принять строку",
            };
        }
        busyRef.current = false;
        setBusy(false);
        keepCameraLive();
        if (result.ok) {
            const typed = compactQr(draftRef.current);
            if (typed.length === 0 || typed === text)
                writeDraft("");
            else if (readyAthleteQr(typed))
                scheduleFieldAccept(draftRef.current);
            playScanBeep();
            const message = result.packet.cup
                ? `Игрок №${result.packet.bibNumber} принят. ${result.packet.cup}${result.packet.mark ? ` На телефоне: ${result.packet.mark}.` : ""}`
                : `Игрок №${result.packet.bibNumber}, ${result.packet.displayName}, принят. Рыб: ${result.packet.fish}. Периодов: ${result.packet.periods}.${result.packet.mark ? ` На телефоне: ${result.packet.mark}.` : ""} Таблица пересчитана.`;
            setStatus({ tone: "ok", text: message });
            toast("ok", message);
            if (origin === "field")
                fieldRef.current?.focus();
        }
        else {
            if (origin === "field" && compactQr(draftRef.current).length === 0)
                writeDraft(text);
            setStatus({ tone: "err", text: result.error });
            toast("err", result.error);
        }
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next && next !== text)
            void accept(next, "camera");
    }
    function scheduleFieldAccept(value) {
        cancelFieldTimer();
        if (!compactQr(value).startsWith(ATHLETE_PREFIX))
            return;
        fieldTimer.current = window.setTimeout(() => {
            fieldTimer.current = null;
            const ready = readyAthleteQr(draftRef.current);
            if (!ready)
                return;
            void accept(ready, "field");
        }, FIELD_SETTLE_MS);
    }
    useEffect(() => {
        acceptRef.current = (raw, origin) => {
            void accept(raw, origin);
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
        const config = { fps: 10, qrbox: { width: 220, height: 220 }, disableFlip: true };
        const onCode = (decoded) => {
            try {
                acceptRef.current(decoded, "camera");
            }
            catch {
                // Ошибка приёма не должна оборвать цикл кадров.
            }
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
                if (sessionRef.current === session) {
                    setCameraNote("Камера недоступна. Вставьте строку QR ниже.");
                    toast("err", "Камера недоступна. Вставьте строку QR ниже.");
                }
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
        const session = sessionRef.current + 1;
        sessionRef.current = session;
        void startScanner(session);
        return () => {
            sessionRef.current += 1;
            cancelFieldTimer();
            const scanner = scannerRef.current;
            scannerRef.current = null;
            if (scanner?.isScanning)
                void scanner.stop().catch(() => undefined);
        };
    }, []);
    return (<div className="mb-3" onPointerDown={primeScanBeep}>
      <div className="rounded-3xl border border-white/10 bg-slate-900 p-4">
        <p className="text-sm font-semibold text-slate-300">{cameraNote}</p>
        <ScannerSurface />
        <form className="mt-4" onSubmit={(event) => {
            event.preventDefault();
            cancelFieldTimer();
            void accept(draftRef.current, "field");
        }}>
          <label className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase" htmlFor="qr-paste">
            Строка QR для проверки без камеры
          </label>
          <textarea id="qr-paste" ref={fieldRef} className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300" value={draft} placeholder="FTP1|4|QF|1=3" onChange={(event) => {
            const value = event.target.value;
            writeDraft(value);
            scheduleFieldAccept(value);
        }}/>
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
