/**
 * Ставит service worker, который при первом заходе с сетью забирает HTML, JS, CSS и иконки в память телефона.
 * Регистрация не ждёт IndexedDB: журнал читается отдельно.
 */
export declare function registerAppShell(): void;
