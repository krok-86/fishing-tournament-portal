/** Заявка игрока до выезда. Утром на берегу интернет уже не нужен: вход по стартовому QR. */
export declare function registerOnline(fullName: string): Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
}>;
/** Список ФИО в порядке заявок. Номера 1, 2, 3 лист назначает сам при импорте. */
export declare function loadOnlineNames(): Promise<{
    ok: true;
    names: string[];
} | {
    ok: false;
    error: string;
}>;
