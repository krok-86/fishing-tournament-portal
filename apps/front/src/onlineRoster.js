/** Заявка игрока до выезда. Утром на берегу интернет уже не нужен: вход по стартовому QR. */
export async function registerOnline(fullName) {
    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ fullName }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
            return { ok: false, error: readError(body) ?? "Не удалось отправить заявку" };
        return { ok: true };
    }
    catch {
        return { ok: false, error: "Нет связи с сервером регистрации. Проверьте интернет и повторите." };
    }
}
/** Список ФИО в порядке заявок. Номера 1, 2, 3 лист назначает сам при импорте. */
export async function loadOnlineNames() {
    try {
        const response = await fetch("/api/participants", { headers: { Accept: "application/json" } });
        const body = await response.json().catch(() => null);
        if (!response.ok)
            return { ok: false, error: readError(body) ?? "Сервер не отдал список заявок" };
        const names = namesFromPayload(body);
        if (!names)
            return { ok: false, error: "Сервер вернул список в неожиданном виде" };
        return { ok: true, names };
    }
    catch {
        return { ok: false, error: "Нет связи с сервером регистрации. Проверьте интернет и повторите." };
    }
}
function readError(body) {
    if (!body || typeof body !== "object" || !("error" in body))
        return null;
    return typeof body.error === "string" && body.error.trim().length > 0 ? body.error : null;
}
function namesFromPayload(body) {
    if (!body || typeof body !== "object" || !("participants" in body))
        return null;
    const list = body.participants;
    if (!Array.isArray(list))
        return null;
    const names = [];
    for (const item of list) {
        if (typeof item === "string") {
            names.push(item);
            continue;
        }
        if (!item || typeof item !== "object")
            return null;
        const record = item;
        const value = record.fullName ?? record.displayName ?? record.name;
        if (typeof value !== "string")
            return null;
        names.push(value);
    }
    return names;
}
