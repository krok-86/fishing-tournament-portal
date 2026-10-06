import { previewPlayoffScore, scorePlayoffDuel } from "../../../../packages/shared/src/calculator.ts";
import { useMatchStore } from "../store.ts";
export function playoffStageTitle(stage) {
    if (stage === "quarterfinal")
        return "1/4 финала";
    if (stage === "semifinal")
        return "1/2 финала";
    return "Финал";
}
export function PlayoffBracket() {
    const stored = useMatchStore((state) => state.playoff);
    const participants = useMatchStore((state) => state.participants);
    const playoffEntryOpen = useMatchStore((state) => state.playoffEntryOpen);
    const selectedPlayoffMatchId = useMatchStore((state) => state.selectedPlayoffMatchId);
    const athleteFish = useMatchStore((state) => state.athleteFish);
    const opponentFish = useMatchStore((state) => state.opponentFish);
    const confirmed = useMatchStore((state) => state.confirmed);
    const openPlayoffEntry = useMatchStore((state) => state.openPlayoffEntry);
    const drafting = playoffEntryOpen && !confirmed && (athleteFish > 0 || opponentFish > 0);
    const playoff = drafting
        ? previewPlayoffScore(stored, selectedPlayoffMatchId, athleteFish, opponentFish)
        : stored;
    if (!playoff.formed || !playoff.final || playoff.quarterfinals.length < 4 || playoff.semifinals.length < 2) {
        return null;
    }
    const nameOf = (slotId) => {
        if (!slotId)
            return "Победитель пары";
        const person = participants.find((participant) => participant.slotId === slotId);
        return person ? `${person.bibNumber}. ${person.displayName}` : "—";
    };
    const quarter = playoff.quarterfinals;
    const semi = playoff.semifinals;
    const championId = playoff.final.winnerSlotId;
    const openMatch = (match) => {
        if (!match.slotIdA || !match.slotIdB)
            return undefined;
        return () => openPlayoffEntry(match.matchId);
    };
    return (<section className="mt-6" aria-label="Сетка плей-офф">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black tracking-tight sm:text-2xl">Плей-офф</h2>
          <p className="text-xs text-slate-400 sm:text-sm">
            1/4, 1/2 и финал. Нажмите пару, чтобы ввести поимки. При равенстве дальше идёт более высокое место отбора.
          </p>
        </div>
        <p className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold tracking-wide text-cyan-100 uppercase">
          На выбывание
        </p>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl shadow-black/30 sm:p-5">
        <div className="flex min-w-[820px] items-center">
          <div className="flex flex-1 flex-col gap-6">
            <BracketHalf left={[quarter[0], quarter[3]]} right={semi[0]} nameOf={nameOf} activeMatchId={playoffEntryOpen ? selectedPlayoffMatchId : ""} openMatch={openMatch}/>
            <BracketHalf left={[quarter[1], quarter[2]]} right={semi[1]} nameOf={nameOf} activeMatchId={playoffEntryOpen ? selectedPlayoffMatchId : ""} openMatch={openMatch}/>
          </div>
          <BracketJoin />
          <div className="w-60 shrink-0">
            <MatchCard match={playoff.final} nameOf={nameOf} featured active={playoffEntryOpen && selectedPlayoffMatchId === playoff.final.matchId} onOpen={openMatch(playoff.final)}/>
          </div>
        </div>
      </div>

      {championId && (<p className="mt-4 rounded-2xl bg-gradient-to-r from-amber-200 via-amber-400 to-orange-400 px-4 py-3 text-center text-lg font-black text-slate-950">
          Победитель турнира: {nameOf(championId)}
        </p>)}
    </section>);
}
export function PlayoffEntryDialog() {
    const open = useMatchStore((state) => state.playoffEntryOpen);
    const playoff = useMatchStore((state) => state.playoff);
    const selectedPlayoffMatchId = useMatchStore((state) => state.selectedPlayoffMatchId);
    const athleteName = useMatchStore((state) => state.athleteName);
    const opponentName = useMatchStore((state) => state.opponentName);
    const athleteFish = useMatchStore((state) => state.athleteFish);
    const opponentFish = useMatchStore((state) => state.opponentFish);
    const saving = useMatchStore((state) => state.saving);
    const confirmed = useMatchStore((state) => state.confirmed);
    const error = useMatchStore((state) => state.error);
    const adjustFish = useMatchStore((state) => state.adjustFish);
    const confirmPeriod = useMatchStore((state) => state.confirmPeriod);
    const closePlayoffEntry = useMatchStore((state) => state.closePlayoffEntry);
    const match = [...playoff.quarterfinals, ...playoff.semifinals, ...(playoff.final ? [playoff.final] : [])].find((item) => item.matchId === selectedPlayoffMatchId);
    if (!open || !match?.slotIdA || !match.slotIdB || match.placeA === null || match.placeB === null || match.seedA === null || match.seedB === null) {
        return null;
    }
    const decision = scorePlayoffDuel(athleteFish, opponentFish, match.placeA, match.seedA, match.placeB, match.seedB);
    const winnerName = decision.winner === "a" ? athleteName : opponentName;
    const tied = athleteFish === opponentFish;
    const started = athleteFish > 0 || opponentFish > 0 || confirmed;
    return (<div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <section role="dialog" aria-labelledby="playoff-entry-title" className="pointer-events-auto mx-auto w-full max-w-lg rounded-3xl border border-cyan-300/40 bg-slate-900 p-4 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-cyan-200 uppercase">Поимки этапа</p>
            <h2 id="playoff-entry-title" className="text-xl font-black">
              {playoffStageTitle(match.stage)}
            </h2>
          </div>
          <button type="button" className="h-10 rounded-xl px-3 text-sm font-bold text-slate-300" onClick={closePlayoffEntry} disabled={saving}>
            Закрыть
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          <CatchRow title={athleteName} place={match.placeA} count={athleteFish} disabled={saving} onPlus={() => adjustFish("athlete", 1)} onMinus={() => adjustFish("athlete", -1)}/>
          <CatchRow title={opponentName} place={match.placeB} count={opponentFish} disabled={saving} onPlus={() => adjustFish("opponent", 1)} onMinus={() => adjustFish("opponent", -1)}/>
        </div>

        <p className={`mt-3 rounded-2xl px-3 py-2 text-sm font-semibold ${started && tied ? "bg-amber-300/15 text-amber-100" : "bg-cyan-300/10 text-cyan-50"}`}>
          {started
            ? tied
                ? `Ничья ${athleteFish}:${opponentFish}. Дальше проходит ${winnerName}: место отбора выше.`
                : `Дальше проходит ${winnerName} по поимкам.`
            : "Введите поимки. При ничьей дальше идёт более высокое место отбора."}
        </p>

        <button type="button" className="mt-3 h-14 w-full rounded-2xl bg-amber-400 text-base font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={saving || confirmed} onClick={() => void confirmPeriod()}>
          {saving ? "Сохраняем..." : confirmed ? "Дуэль сохранена" : "Подтвердить поимки"}
        </button>
        {error && <p className="mt-2 text-center text-sm text-rose-300">{error}</p>}
      </section>
    </div>);
}
function BracketHalf({ left, right, nameOf, activeMatchId, openMatch, }) {
    return (<div className="flex items-center">
      <div className="flex w-60 shrink-0 flex-col gap-3">
        <MatchCard match={left[0]} nameOf={nameOf} active={activeMatchId === left[0].matchId} onOpen={openMatch(left[0])}/>
        <MatchCard match={left[1]} nameOf={nameOf} active={activeMatchId === left[1].matchId} onOpen={openMatch(left[1])}/>
      </div>
      <BracketJoin />
      <div className="w-60 shrink-0">
        <MatchCard match={right} nameOf={nameOf} active={activeMatchId === right.matchId} onOpen={openMatch(right)}/>
      </div>
    </div>);
}
function BracketJoin() {
    return (<div className="relative mx-1 w-8 shrink-0 self-stretch" aria-hidden="true">
      <div className="absolute top-[22%] bottom-[22%] left-0 w-4 rounded-r-2xl border-y-2 border-r-2 border-cyan-200/40"/>
      <div className="absolute top-1/2 left-4 h-0.5 w-4 -translate-y-1/2 bg-cyan-200/40"/>
    </div>);
}
function MatchCard({ match, nameOf, featured = false, active = false, onOpen, }) {
    const className = `w-full overflow-hidden rounded-2xl border bg-slate-900 text-left ${active
        ? "border-cyan-300 ring-2 ring-cyan-300"
        : featured
            ? "border-amber-300/50 shadow-lg shadow-amber-400/10"
            : "border-white/10"} ${onOpen ? "cursor-pointer hover:border-cyan-200/50" : ""}`;
    const body = (<>
      <p className="bg-slate-950 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-slate-400 uppercase">
        {playoffStageTitle(match.stage)}
        {match.seedA !== null && match.seedB !== null ? ` · ${match.seedA}—${match.seedB}` : ""}
      </p>
      <MatchSide name={nameOf(match.slotIdA)} place={match.placeA} fish={match.fishA} winner={match.winnerSlotId !== null && match.winnerSlotId === match.slotIdA} waiting={match.slotIdA === null}/>
      <MatchSide name={nameOf(match.slotIdB)} place={match.placeB} fish={match.fishB} winner={match.winnerSlotId !== null && match.winnerSlotId === match.slotIdB} waiting={match.slotIdB === null} divider/>
      {match.decidedBy === "qualifyingPlace" && (<p className="border-t border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100">
          Ничья по поимкам · тай-брейк отбора
        </p>)}
    </>);
    if (!onOpen) {
        return (<article className={className} data-match-id={match.matchId}>
        {body}
      </article>);
    }
    return (<button type="button" className={className} data-match-id={match.matchId} aria-label={`Ввести поимки, ${playoffStageTitle(match.stage)}: ${nameOf(match.slotIdA)} — ${nameOf(match.slotIdB)}`} aria-pressed={active} onClick={onOpen}>
      {body}
    </button>);
}
function MatchSide({ name, place, fish, winner, waiting, divider = false, }) {
    return (<div className={`flex items-center justify-between gap-2 px-3 py-2 ${divider ? "border-t border-white/10" : ""} ${winner ? "bg-cyan-300/15 text-cyan-50" : "text-slate-200"}`} data-advanced={winner ? "true" : "false"}>
      <span className={`min-w-0 truncate text-sm font-semibold ${waiting ? "text-slate-500" : ""}`}>{name}</span>
      <span className="flex shrink-0 items-center gap-2">
        {place !== null && <span className="text-[10px] font-bold text-slate-400">#{place}</span>}
        <span className="w-6 text-right text-base font-black tabular-nums">{fish === null ? "–" : fish}</span>
      </span>
    </div>);
}
function CatchRow({ title, place, count, disabled, onPlus, onMinus, }) {
    return (<div className="flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{title}</p>
        <p className="text-[11px] font-semibold text-slate-400">Место отбора {place}</p>
      </div>
      <button type="button" className="h-11 w-11 rounded-xl bg-rose-500 text-lg font-black text-white disabled:opacity-40" disabled={disabled || count === 0} onClick={onMinus} aria-label={`Минус, ${title}`}>
        −
      </button>
      <p className="w-8 text-center text-2xl font-black tabular-nums">{count}</p>
      <button type="button" className="h-11 w-11 rounded-xl bg-emerald-400 text-lg font-black text-slate-950 disabled:opacity-40" disabled={disabled} onClick={onPlus} aria-label={`Плюс, ${title}`}>
        +
      </button>
    </div>);
}
