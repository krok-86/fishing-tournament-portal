import { useEffect, useState } from "react";
import { AthleteQrButton } from "./components/AthleteQrButton.tsx";
import { Leaderboard } from "./components/Leaderboard.tsx";
import { PlayoffEntryDialog, playoffStageTitle } from "./components/PlayoffBracket.tsx";
import { TournamentInit } from "./components/TournamentInit.tsx";
import { formatClock, useMatchStore } from "./store.ts";
import { playoffMatches } from "../../../packages/shared/src/calculator.ts";
import { QUALIFYING_PERIODS } from "../../../packages/shared/src/types.ts";
function App() {
    const [screen, setScreen] = useState("setup");
    const sectorLabel = useMatchStore((state) => state.sectorLabel);
    const sideLabel = useMatchStore((state) => state.sideLabel);
    const period = useMatchStore((state) => state.period);
    const athleteName = useMatchStore((state) => state.athleteName);
    const opponentName = useMatchStore((state) => state.opponentName);
    const opponentSlotId = useMatchStore((state) => state.opponentSlotId);
    const athleteFish = useMatchStore((state) => state.athleteFish);
    const opponentFish = useMatchStore((state) => state.opponentFish);
    const secondsLeft = useMatchStore((state) => state.secondsLeft);
    const confirmed = useMatchStore((state) => state.confirmed);
    const saving = useMatchStore((state) => state.saving);
    const savedCount = useMatchStore((state) => state.savedCount);
    const error = useMatchStore((state) => state.error);
    const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
    const adjustFish = useMatchStore((state) => state.adjustFish);
    const tick = useMatchStore((state) => state.tick);
    const confirmPeriod = useMatchStore((state) => state.confirmPeriod);
    const hydrate = useMatchStore((state) => state.hydrate);
    useEffect(() => {
        void hydrate();
    }, [hydrate]);
    useEffect(() => {
        const timer = window.setInterval(() => tick(), 1000);
        return () => window.clearInterval(timer);
    }, [tick]);
    return (<main className={`mx-auto flex min-h-dvh w-full flex-col bg-slate-950 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white sm:px-6 ${screen === "table" ? "max-w-6xl" : "max-w-lg"}`}>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-900 p-1" role="tablist">
        <TabButton active={screen === "judge"} onClick={() => setScreen("judge")}>
          Ввод результатов (Судья/Игрок)
        </TabButton>
        <TabButton active={screen === "table"} onClick={() => setScreen("table")}>
          Таблица лидеров (Орг)
        </TabButton>
        <TabButton active={screen === "setup"} onClick={() => setScreen("setup")}>
          Настройка турнира
        </TabButton>
      </div>

      {screen === "table" ? (<Leaderboard />) : screen === "setup" ? (<TournamentInit onOpened={() => setScreen("judge")}/>) : (<JudgeScreen sectorLabel={sectorLabel} sideLabel={sideLabel} period={period} secondsLeft={secondsLeft} athleteName={athleteName} opponentName={opponentName} athleteFish={athleteFish} opponentFish={opponentFish} hasOpponent={opponentSlotId.length > 0} tournamentOpened={tournamentOpened} confirmed={confirmed} saving={saving} savedCount={savedCount} error={error} adjustFish={adjustFish} confirmPeriod={confirmPeriod}/>)}
      <PlayoffEntryDialog />
    </main>);
}
function TabButton({ active, onClick, children }) {
    return (<button type="button" role="tab" aria-selected={active} className={`min-h-12 rounded-xl px-1 text-[10px] leading-tight font-black sm:px-2 sm:text-xs ${active ? "bg-cyan-300 text-slate-950" : "text-slate-300"}`} onClick={onClick}>
      {children}
    </button>);
}
function JudgeScreen({ sectorLabel, sideLabel, period, secondsLeft, athleteName, opponentName, athleteFish, opponentFish, hasOpponent, tournamentOpened, confirmed, saving, savedCount, error, adjustFish, confirmPeriod, }) {
    const participants = useMatchStore((state) => state.participants);
    const athleteSlotId = useMatchStore((state) => state.athleteSlotId);
    const selfSlotId = useMatchStore((state) => state.selfSlotId);
    const briefing = useMatchStore((state) => state.briefing);
    const selectAthlete = useMatchStore((state) => state.selectAthlete);
    const setPeriod = useMatchStore((state) => state.setPeriod);
    const playoff = useMatchStore((state) => state.playoff);
    const selectedPlayoffMatchId = useMatchStore((state) => state.selectedPlayoffMatchId);
    const playoffEntryOpen = useMatchStore((state) => state.playoffEntryOpen);
    const openPlayoffEntry = useMatchStore((state) => state.openPlayoffEntry);
    const closePlayoffEntry = useMatchStore((state) => state.closePlayoffEntry);
    const playoffFormed = playoff.formed;
    const locked = !tournamentOpened || saving || athleteSlotId.length === 0 || (!playoffFormed && confirmed);
    const fishing = participants.filter((participant) => !participant.ghost);
    const cupMatches = playoffMatches(playoff);
    const nameOf = (slotId) => {
        if (!slotId)
            return "Победитель пары";
        const person = participants.find((participant) => participant.slotId === slotId);
        return person ? `${person.bibNumber}. ${person.displayName}` : "—";
    };
    return (<>
      {tournamentOpened && !playoffFormed && (<div className="mt-4 grid grid-cols-8 gap-1" role="group" aria-label="Период отбора">
          {QUALIFYING_PERIODS.map((item) => (<button key={item} type="button" className={`h-10 rounded-xl text-sm font-black ${item === period ? "bg-cyan-300 text-slate-950" : "bg-slate-900 text-slate-300"}`} onClick={() => setPeriod(item)}>
              {item}
            </button>))}
        </div>)}

      {playoffFormed && (<>
        <label className="mt-4 block rounded-3xl bg-slate-900 px-4 py-4" htmlFor="playoff-match">
          <span className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Кубковая пара</span>
          <select id="playoff-match" className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base font-semibold text-white outline-none focus:border-cyan-300 disabled:opacity-50" value={selectedPlayoffMatchId} disabled={saving} onChange={(event) => {
                const matchId = event.target.value;
                if (!matchId) {
                    closePlayoffEntry();
                    return;
                }
                openPlayoffEntry(matchId);
            }}>
            <option value="">Выберите пару</option>
            {cupMatches.map((match) => (<option key={match.matchId} value={match.matchId} disabled={!match.slotIdA || !match.slotIdB}>
                {playoffStageTitle(match.stage)}: {nameOf(match.slotIdA)} — {nameOf(match.slotIdB)}
              </option>))}
          </select>
        </label>
        {selectedPlayoffMatchId && !playoffEntryOpen && (<button type="button" className="mt-3 h-12 w-full rounded-xl bg-cyan-300 text-sm font-black text-slate-950 disabled:opacity-40" disabled={saving} onClick={() => openPlayoffEntry(selectedPlayoffMatchId)}>
            Ввести поимки
          </button>)}
        </>)}

      {tournamentOpened && (<label className="mt-4 block rounded-3xl bg-slate-900 px-4 py-4" htmlFor="athlete-number">
          <span className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Ваш номер</span>
          {playoffFormed && (<span className="mt-1 block text-xs font-semibold tracking-normal text-slate-400 normal-case">
              В QR попадёт счёт этого номера в выбранной паре.
            </span>)}
          <select id="athlete-number" className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base font-semibold text-white outline-none focus:border-cyan-300 disabled:opacity-50" value={playoffFormed ? selfSlotId : athleteSlotId} disabled={saving} onChange={(event) => selectAthlete(event.target.value)}>
            <option value="">Выберите номер</option>
            {fishing.map((participant) => (<option key={participant.slotId} value={participant.slotId}>
                Игрок №{participant.bibNumber}
              </option>))}
          </select>
        </label>)}

      <header className="mt-4 rounded-3xl bg-gradient-to-br from-cyan-400 to-teal-700 px-5 py-6 text-slate-950 shadow-lg">
        <p className="text-sm font-semibold tracking-[0.2em] uppercase">{playoffFormed ? "Плей-офф" : "Сектор"}</p>
        <p className="mt-1 text-6xl leading-none font-black tracking-tight">{sectorLabel}</p>
        {athleteSlotId && !playoffFormed && (<p className="mt-3 inline-flex rounded-full bg-slate-950 px-4 py-2 text-2xl font-black tracking-wide text-cyan-200">
            {sideLabel}
          </p>)}
        {briefing ? (<p className="mt-4 text-base leading-snug font-bold">{briefing}</p>) : (tournamentOpened && (<p className="mt-4 text-base leading-snug font-bold">
              Выберите номер — сектор и соперник подставятся из сетки.
            </p>))}
      </header>

      <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-center" aria-live="polite">
        <p className="text-sm font-medium tracking-wide text-cyan-100/80 uppercase">
          {playoffFormed ? "Кубковая дуэль" : `Период ${period}`}
        </p>
        <p className="mt-1 font-mono text-6xl font-semibold tabular-nums tracking-tight">{formatClock(secondsLeft)}</p>
      </section>

      {!tournamentOpened && (<p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">
          Сначала откройте турнир во вкладке «Настройка турнира».
        </p>)}

      <section className="mt-4 grid flex-1 gap-4">
        <ScoreCard title={athleteName} count={athleteFish} disabled={locked} onPlus={() => adjustFish("athlete", 1)} onMinus={() => adjustFish("athlete", -1)}/>
        <ScoreCard title={opponentName} count={opponentFish} disabled={locked || !hasOpponent} onPlus={() => adjustFish("opponent", 1)} onMinus={() => adjustFish("opponent", -1)}/>
      </section>

      <div className="sticky bottom-0 mt-4 bg-gradient-to-t from-slate-950 via-slate-950 to-slate-950/0 pt-3">
        <button type="button" className="h-16 w-full rounded-2xl bg-amber-400 text-lg font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={locked || confirmed} onClick={() => void confirmPeriod()}>
          {saving
            ? "Сохраняем..."
            : confirmed
                ? playoffFormed
                    ? "Дуэль сохранена"
                    : "Период сохранён"
                : playoffFormed
                    ? "Подтвердить результат дуэли"
                    : "Подтвердить результат периода"}
        </button>
        {savedCount !== null && (<p className="mt-2 text-center text-sm text-emerald-300">В IndexedDB записано событий: {savedCount}</p>)}
        {error && <p className="mt-2 text-center text-sm text-rose-300">{error}</p>}
        <AthleteQrButton />
      </div>
    </>);
}
function ScoreCard({ title, count, disabled, onPlus, onMinus, }) {
    return (<article className="rounded-3xl bg-slate-900 px-4 py-4">
      <div className="flex items-end justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-xl leading-tight font-bold">{title}</h2>
        <p className="text-5xl leading-none font-black tabular-nums">{count}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className="h-24 rounded-2xl bg-emerald-400 text-2xl font-black tracking-wide text-slate-950 active:bg-emerald-300 disabled:opacity-40" disabled={disabled} onClick={onPlus}>
          ПЛЮС
        </button>
        <button type="button" className="h-24 rounded-2xl bg-rose-500 text-2xl font-black tracking-wide text-white active:bg-rose-400 disabled:opacity-40" disabled={disabled || count === 0} onClick={onMinus}>
          МИНУС
        </button>
      </div>
    </article>);
}
export default App;
