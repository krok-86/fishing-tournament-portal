import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "../toast.ts";
function cameraFailureNote(error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (!window.isSecureContext || name === "SecurityError") {
        return "Камера закрыта: страница открыта по http, а в chrome://flags пункт всё ещё «Отключено». Поставьте «Включено», впишите адрес этой страницы и нажмите «Перезапустить».";
    }
    if (name === "NotAllowedError" || name === "NotFoundError") {
        return "Браузер не дал камеру. Нажмите значок слева от адреса, откройте разрешения, поставьте камеру «Разрешить» и снова нажмите «Включить камеру».";
    }
    const detail = [name, message].filter(Boolean).join(": ");
    return detail ? `Камера не включилась. ${detail}` : "Камера не включилась.";
}
export function DrawScanner({ title, hint, onCode, onClose, }) {
    const [draft, setDraft] = useState("");
    const [cameraNote, setCameraNote] = useState("Нажмите «Включить камеру». Запрос должен идти от кнопки, иначе телефон её не отдаёт.");
    const [cameraOn, setCameraOn] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const aliveRef = useRef(true);
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
        setError(null);
        const failure = await onCode(text);
        busyRef.current = false;
        if (!aliveRef.current)
            return;
        setBusy(false);
        if (failure) {
            setError(failure);
            return;
        }
        onClose();
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
    function failCamera(error) {
        setCameraNote(cameraFailureNote(error));
        toast("err", "Камера не включилась");
    }
    function enableCamera() {
        const session = sessionRef.current + 1;
        sessionRef.current = session;
        setCameraOn(false);
        setCameraNote("Включаем камеру…");
        const permission = navigator.mediaDevices?.getUserMedia?.({
            audio: false,
            video: { facingMode: { ideal: "environment" } },
        });
        void startScanner(session, permission);
    }
    async function startScanner(session, permission) {
        if (!permission) {
            if (sessionRef.current === session)
                failCamera(new Error("mediaDevices"));
            return;
        }
        try {
            const stream = await permission;
            stream.getTracks().forEach((track) => track.stop());
        }
        catch (error) {
            if (sessionRef.current === session)
                failCamera(error);
            return;
        }
        await stopScanner();
        if (sessionRef.current !== session)
            return;
        const scanner = new Html5Qrcode("organizer-draw-reader", { verbose: false });
        scannerRef.current = scanner;
        const config = { fps: 8, qrbox: { width: 240, height: 240 } };
        const onScan = (text) => {
            acceptRef.current(text);
        };
        try {
            await scanner.start({ facingMode: "environment" }, config, onScan, () => undefined);
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
                await scanner.start({ facingMode: "user" }, config, onScan, () => undefined);
            }
            catch (error) {
                if (sessionRef.current === session)
                    failCamera(error);
                return;
            }
        }
        if (sessionRef.current !== session) {
            await stopScanner();
            return;
        }
        setCameraOn(true);
        setCameraNote(hint);
    }
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
            sessionRef.current += 1;
            const scanner = scannerRef.current;
            scannerRef.current = null;
            if (scanner?.isScanning)
                void scanner.stop().catch(() => undefined);
        };
    }, []);
    return (<div className="mt-4 rounded-3xl border border-white/10 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-black leading-tight">{title}</h2>
        <button type="button" className="h-10 shrink-0 rounded-xl border border-white/10 px-3 text-xs font-bold text-slate-300" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-300">{cameraNote}</p>
      <button type="button" className="mt-3 h-14 w-full rounded-2xl bg-cyan-300 text-base font-black text-slate-950 disabled:opacity-40" disabled={cameraOn} onClick={enableCamera}>
        {cameraOn ? "Камера включена" : "Включить камеру"}
      </button>
      <div id="organizer-draw-reader" className="mt-3 min-h-56 overflow-hidden rounded-2xl bg-black"/>
      <form className="mt-4" onSubmit={(event) => {
            event.preventDefault();
            void accept(draft);
        }}>
        <label className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase" htmlFor="draw-qr-paste">
          Строка QR, если камера не берёт экран
        </label>
        <textarea id="draw-qr-paste" className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-slate-500 focus:border-cyan-300" value={draft} placeholder="FTPS1.…" onChange={(event) => setDraft(event.target.value)}/>
        <button type="submit" className="mt-3 h-14 w-full rounded-2xl bg-cyan-300 text-base font-black text-slate-950 disabled:opacity-40" disabled={busy || draft.trim().length === 0}>
          {busy ? "Записываем…" : "Принять строку"}
        </button>
      </form>
      {error && (<p className="mt-3 text-sm font-semibold text-rose-300" aria-live="polite">
          {error}
        </p>)}
    </div>);
}
