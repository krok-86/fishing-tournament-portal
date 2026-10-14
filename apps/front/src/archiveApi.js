export async function postTournamentArchive(snapshot, tournamentId = snapshot.tournament.id) {
    const id = tournamentId.trim();
    try {
        const response = await fetch("/api/tournaments/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ ...snapshot, tournamentId: id }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
            return { ok: false, error: readError(body) ?? "Сервер не принял архив турнира" };
        if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || body.id.length === 0) {
            return { ok: false, error: "Сервер не вернул ссылку на архив" };
        }
        const path = "path" in body && typeof body.path === "string" && body.path.startsWith("/archive/")
            ? body.path
            : `/archive/${body.id}`;
        return { ok: true, id: body.id, path };
    }
    catch {
        return { ok: false, error: "Нет связи с сервером архива. Проверьте, что он запущен, и повторите." };
    }
}
export async function listTournamentArchives() {
    try {
        const response = await fetch("/api/tournaments/archive", {
            headers: { Accept: "application/json" },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
            return { ok: false, error: readError(body) ?? "Список архивов не открылся" };
        const archives = archivesFromPayload(body);
        if (!archives)
            return { ok: false, error: "Список архивов записан в неожиданном виде" };
        return { ok: true, archives };
    }
    catch {
        return { ok: false, error: "Нет связи с сервером архива. Проверьте, что он запущен, и повторите." };
    }
}
export async function deleteTournamentArchive(id) {
    try {
        const response = await fetch(`/api/tournaments/archive/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { Accept: "application/json" },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
            return { ok: false, error: readError(body) ?? "Не удалось удалить турнир из архива" };
        return { ok: true };
    }
    catch {
        return { ok: false, error: "Нет связи с сервером архива. Проверьте, что он запущен, и повторите." };
    }
}
export async function loadTournamentArchive(id) {
    try {
        const response = await fetch(`/api/tournaments/archive/${encodeURIComponent(id)}`, {
            headers: { Accept: "application/json" },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
            return { ok: false, error: readError(body) ?? "Архив не открылся" };
        const snapshot = snapshotFromPayload(body);
        if (!snapshot)
            return { ok: false, error: "Архив записан в неожиданном виде" };
        return { ok: true, snapshot };
    }
    catch {
        return { ok: false, error: "Нет связи с сервером архива. Проверьте интернет и повторите." };
    }
}
function archivesFromPayload(body) {
    if (!body || typeof body !== "object" || !("archives" in body) || !Array.isArray(body.archives))
        return null;
    const archives = [];
    for (const item of body.archives) {
        if (!item || typeof item !== "object")
            return null;
        const row = item;
        if (typeof row.id !== "string" || row.id.length === 0)
            return null;
        if (typeof row.name !== "string")
            return null;
        archives.push({
            id: row.id,
            name: row.name,
            date: typeof row.date === "string" ? row.date : "",
            champion: typeof row.champion === "string" ? row.champion : "",
        });
    }
    return archives;
}
function snapshotFromPayload(body) {
    if (!body || typeof body !== "object" || !("snapshot" in body))
        return null;
    return isArchiveSnapshot(body.snapshot) ? body.snapshot : null;
}
export function isArchiveSnapshot(value) {
    if (!value || typeof value !== "object")
        return false;
    const row = value;
    return (!!row.tournament &&
        typeof row.tournament.id === "string" &&
        typeof row.tournament.name === "string" &&
        typeof row.tournament.date === "string" &&
        Array.isArray(row.participants) &&
        Array.isArray(row.finalStandings) &&
        Array.isArray(row.qualifyingLeaderboard) &&
        Array.isArray(row.catches) &&
        !!row.playoff &&
        Array.isArray(row.playoff.quarterfinals) &&
        Array.isArray(row.playoff.semifinals));
}
function readError(body) {
    if (!body || typeof body !== "object" || !("error" in body))
        return null;
    return typeof body.error === "string" && body.error.trim().length > 0 ? body.error : null;
}
