import { useEffect, useState } from "react";
import type { TournamentArchiveSnapshot } from "../../../../packages/shared/src/archive.ts";
import { loadTournamentArchive } from "../archiveApi.ts";
import { PlayoffBracket } from "./PlayoffBracket.tsx";

export function ArchivePage({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<TournamentArchiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSnapshot(null);
    setError(null);
    void loadTournamentArchive(id).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSnapshot(result.snapshot);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[90rem] flex-col bg-slate-950 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white sm:px-6">
      {!snapshot && !error && <p className="mt-6 text-sm text-slate-400">Открываем архив турнира…</p>}
      {error && (
        <section className="mt-6 rounded-3xl border border-rose-300/30 bg-rose-950/40 px-5 py-6">
          <h1 className="text-2xl font-black">Архив не найден</h1>
          <p className="mt-2 text-sm text-rose-100">{error}</p>
        </section>
      )}
      {snapshot && <PlayoffBracket snapshot={snapshot} />}
    </main>
  );
}
