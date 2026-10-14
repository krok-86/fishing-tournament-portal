import { registerSW } from "virtual:pwa-register";

let started = false;

/**
 * Ставит service worker, который при первом заходе с сетью забирает HTML, JS, CSS и иконки в память телефона.
 * Регистрация не ждёт IndexedDB: журнал читается отдельно.
 */
export function registerAppShell(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;
  try {
    registerSW({ immediate: true });
  } catch {
    started = false;
  }
}
