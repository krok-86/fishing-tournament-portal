import { useEffect, useState } from "react";
import { deleteTournamentArchive, listTournamentArchives, } from "../archiveApi.ts";
import { toast } from "../toast.ts";
export function TournamentHistory({ canDelete }) {
    const [archives, setArchives] = useState(null);
    const [error, setError] = useState(null);
    const [confirmId, setConfirmId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    useEffect(() => {
        let alive = true;
        void listTournamentArchives().then((result) => {
            if (!alive)
                return;
            if (!result.ok) {
                setError(result.error);
                setArchives([]);
                return;
            }
            setArchives(result.archives);
        });
        return () => {
            alive = false;
        };
    }, []);
    async function remove(id) {
        if (deletingId)
            return;
        setDeletingId(id);
        const result = await deleteTournamentArchive(id);
        setDeletingId(null);
        setConfirmId(null);
        if (!result.ok) {
            toast("err", result.error);
            return;
        }
        setArchives((current) => current?.filter((item) => item.id !== id) ?? []);
        toast("ok", "Турнир удалён из архива");
    }
    return (<section className="mt-4 flex flex-1 flex-col">
      <h2 className="text-lg font-black tracking-tight sm:text-2xl">История турниров</h2>
      <p className="mt-1 text-xs text-slate-400 sm:text-sm">
        Прошедшие соревнования. Отчёт открывается по постоянной ссылке.
      </p>

      {archives === null && <p className="mt-6 text-sm text-slate-400">Читаем архив…</p>}

      {error && (<p className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-950/40 px-4 py-3 text-sm font-semibold text-rose-100">
          {error}
        </p>)}

      {archives && archives.length === 0 && !error && (<p className="mt-6 rounded-3xl border border-white/10 bg-slate-900 px-4 py-6 text-sm text-slate-300">
          Пока нет прошедших соревнований. Архив появится после кнопки «Завершить и архивировать турнир».
        </p>)}

      {archives && archives.length > 0 && (<ul className="mt-4 grid gap-3">
          {archives.map((item) => (<li key={item.id} className="rounded-3xl border border-amber-200/15 bg-slate-900 px-4 py-4 shadow-lg shadow-black/20">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-200 to-amber-500 text-3xl shadow-inner" aria-hidden="true">
                    🏆
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg leading-tight font-black text-white">{item.name}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-300">{formatArchiveDate(item.date)}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-semibold text-slate-400">Чемпион: </span>
                      <span className="font-black text-amber-100">{item.champion || "—"}</span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 sm:shrink-0">
                  <a className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 sm:flex-none" href={`/archive/${encodeURIComponent(item.id)}`}>
                    Открыть отчет
                  </a>
                  {canDelete && (<button type="button" className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-rose-500 px-4 text-sm font-black text-white disabled:opacity-40 sm:flex-none" disabled={deletingId === item.id} onClick={() => {
                        if (confirmId !== item.id) {
                            setConfirmId(item.id);
                            return;
                        }
                        void remove(item.id);
                    }}>
                      {deletingId === item.id ? "Удаляем…" : confirmId === item.id ? "Точно удалить" : "Удалить"}
                    </button>)}
                </div>
              </div>
            </li>))}
        </ul>)}
    </section>);
}
function formatArchiveDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match)
        return iso || "Дата не указана";
    return `${match[3]}.${match[2]}.${match[1]}`;
}
