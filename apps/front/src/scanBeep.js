let shared = null;
function audioCtor() {
    if (typeof window === "undefined")
        return null;
    const candidate = window.AudioContext ?? window.webkitAudioContext;
    return candidate ?? null;
}
function context() {
    const Ctor = audioCtor();
    if (!Ctor)
        return null;
    if (!shared || shared.state === "closed")
        shared = new Ctor();
    return shared;
}
/** Жест открытия вкладки сканера снимает блокировку звука в браузере. */
export function primeScanBeep() {
    const ctx = context();
    if (ctx && ctx.state === "suspended")
        void ctx.resume();
}
/** Короткий чистый бип успешного сканирования. Без файлов, одна синусоида. */
export function playScanBeep() {
    try {
        const ctx = context();
        if (!ctx)
            return;
        if (ctx.state === "suspended")
            void ctx.resume();
        const now = ctx.currentTime;
        const tone = ctx.createOscillator();
        const gain = ctx.createGain();
        tone.type = "sine";
        tone.frequency.setValueAtTime(1480, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        tone.connect(gain);
        gain.connect(ctx.destination);
        tone.start(now);
        tone.stop(now + 0.1);
        tone.onended = () => {
            tone.disconnect();
            gain.disconnect();
        };
    }
    catch {
        // Нет динамика — приём кода от этого не зависит.
    }
}
