import { useState } from "react";
import { ghostSeatPartner, loneNeighborSlotId, planPeriodOne, waitingParticipants, useMatchStore, } from "../store.ts";
export function TournamentInit({ onOpened }) {
    const participants = useMatchStore((state) => state.participants);
    const sectorCount = useMatchStore((state) => state.sectorCount);
    const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
    const setupSaving = useMatchStore((state) => state.setupSaving);
    const setupError = useMatchStore((state) => state.setupError);
    const hydrated = useMatchStore((state) => state.hydrated);
    const registerParticipant = useMatchStore((state) => state.registerParticipant);
    const seedNumberedStart = useMatchStore((state) => state.seedNumberedStart);
    const replaceParticipant = useMatchStore((state) => state.replaceParticipant);
    const setParticipantGhost = useMatchStore((state) => state.setParticipantGhost);
    const removeParticipant = useMatchStore((state) => state.removeParticipant);
    const clearParticipants = useMatchStore((state) => state.clearParticipants);
    const startTournament = useMatchStore((state) => state.startTournament);
    const resetTournament = useMatchStore((state) => state.resetTournament);
    const [draft, setDraft] = useState("");
    const [arrivalCount, setArrivalCount] = useState("");
    const [opening, setOpening] = useState(false);
    const [seeding, setSeeding] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const matrix = planPeriodOne(participants, sectorCount);
    const waiting = waitingParticipants(participants, sectorCount);
    const locked = tournamentOpened || setupSaving;
    const parsedArrival = Number.parseInt(arrivalCount, 10);
    const arrivalReady = Number.isInteger(parsedArrival) && parsedArrival >= 2 && participants.length === 0;
    async function addParticipant(event) {
        event.preventDefault();
        const name = draft.trim();
        if (!name || locked)
            return;
        const saved = await registerParticipant(name);
        if (saved)
            setDraft("");
    }
    async function seedNumbers(event) {
        event.preventDefault();
        if (!arrivalReady || locked || seeding)
            return;
        setSeeding(true);
        const saved = await seedNumberedStart(parsedArrival);
        setSeeding(false);
        if (saved)
            setArrivalCount("");
    }
    async function clearList() {
        if (locked || participants.length === 0)
            return;
        if (!confirmClear) {
            setConfirmClear(true);
            return;
        }
        setConfirmClear(false);
        await clearParticipants();
    }
    async function open() {
        setOpening(true);
        const started = await startTournament();
        setOpening(false);
        if (started)
            onOpened();
    }
    async function resetAll() {
        if (setupSaving)
            return;
        if (!confirmReset) {
            setConfirmReset(true);
            return;
        }
        setConfirmReset(false);
        const cleared = await resetTournament();
        if (cleared) {
            setDraft("");
            setArrivalCount("");
        }
    }
    if (!hydrated) {
        return (<section className="mt-4">
        <h2 className="text-lg font-black tracking-tight sm:text-2xl">Настройка турнира</h2>
        <p className="mt-3 text-sm text-slate-400">Читаем журнал…</p>
      </section>);
    }
    return (<section className="mt-4 flex flex-1 flex-col gap-4">
      <header>
        <h2 className="text-lg font-black tracking-tight sm:text-2xl">Настройка турнира</h2>
        <p className="mt-1 text-xs text-slate-400 sm:text-sm">
          Раздайте бумажные номера и откройте сетку. Фамилии впишутся по ходу кнопкой «Заменить», поимки рыбаки вводят сами.
        </p>
      </header>

      {tournamentOpened && (<p className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-semibold text-emerald-200">
          Турнир открыт. Сетка на 8 периодов записана. На вводе результатов выберите свой номер.
        </p>)}

      <form className="rounded-3xl bg-slate-900 px-4 py-4" onSubmit={(event) => void seedNumbers(event)}>
        <h3 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Быстрый старт по номерам</h3>
        <p className="mt-2 text-sm text-slate-400">
          Сколько рыбаков приехало. Система создаст «Спортсмен №1», «Спортсмен №2» и дальше по списку.
        </p>
        <div className="mt-3 flex gap-2">
          <input id="arrival-count" className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:opacity-50" inputMode="numeric" min={2} step={1} type="number" value={arrivalCount} placeholder="40" aria-label="Число приехавших рыбаков" disabled={locked || participants.length > 0} onChange={(event) => setArrivalCount(event.target.value)}/>
          <button type="submit" className="h-12 shrink-0 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={locked || !arrivalReady || seeding}>
            {seeding ? "Создаём..." : arrivalReady ? `Создать ${parsedArrival}` : "Создать номера"}
          </button>
        </div>
        {participants.length > 0 && !tournamentOpened && (<div className="mt-3 grid gap-2">
            <p className="text-sm text-amber-200">
              Быстрый старт ждёт пустой лист: участники уже вписаны. Удалите лишних или очистите лист и соберите номера заново.
            </p>
            <button type="button" className="h-10 rounded-xl border border-rose-300/40 bg-rose-400/10 text-xs font-bold text-rose-100 disabled:opacity-40" disabled={setupSaving} onClick={() => void clearList()}>
              {confirmClear ? "Точно очистить лист" : "Очистить лист"}
            </button>
          </div>)}
      </form>

      <form className="rounded-3xl bg-slate-900 px-4 py-4" onSubmit={(event) => void addParticipant(event)}>
        <label className="text-sm font-bold text-slate-200" htmlFor="participant-name">
          Участник
        </label>
        <div className="mt-2 flex gap-2">
          <input id="participant-name" className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:opacity-50" value={draft} placeholder="Имя и Enter" disabled={locked} onChange={(event) => setDraft(event.target.value)}/>
          <button type="submit" className="h-12 shrink-0 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={locked || draft.trim().length === 0}>
            Добавить
          </button>
        </div>
      </form>

      <ParticipantList participants={participants} tournamentOpened={tournamentOpened} setupSaving={setupSaving} onReplace={replaceParticipant} onSetGhost={setParticipantGhost} onRemove={removeParticipant}/>

      <p className="rounded-3xl bg-slate-900 px-4 py-4 text-sm font-bold text-slate-200">
        Секторов на водоёме потребуется: <span className="tabular-nums text-cyan-200">{sectorCount}</span>
      </p>

      <PeriodPlan participants={participants} sectorCount={sectorCount} matrix={matrix} waiting={waiting}/>

      <button type="button" className="h-16 rounded-2xl bg-amber-400 text-lg font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={tournamentOpened || setupSaving || participants.length < 2} onClick={() => void open()}>
        {opening ? "Сохраняем..." : tournamentOpened ? "Турнир открыт" : "Открыть турнир"}
      </button>
      <button type="button" className="h-12 rounded-2xl border border-rose-300/40 bg-rose-400/10 text-sm font-black text-rose-100 disabled:opacity-40" disabled={setupSaving} onClick={() => void resetAll()}>
        {confirmReset ? "Точно сбросить всё" : "Сбросить всё (Hard Reset)"}
      </button>
      {setupError && <p className="text-center text-sm text-rose-300">{setupError}</p>}
    </section>);
}
function ParticipantList({ participants, tournamentOpened, setupSaving, onReplace, onSetGhost, onRemove, }) {
    return (<div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Стартовый лист</h3>
        <p className="text-sm font-semibold text-slate-300">{participants.length}</p>
      </div>
      {participants.length === 0 ? (<p className="mt-3 text-sm text-slate-400">Пока никого нет. Создайте номера или введите имя.</p>) : (<ol className="mt-3 grid gap-2">
          {participants.map((participant) => (<ParticipantRow key={participant.slotId} participant={participant} tournamentOpened={tournamentOpened} setupSaving={setupSaving} onReplace={onReplace} onSetGhost={onSetGhost} onRemove={onRemove}/>))}
        </ol>)}
    </div>);
}
function ParticipantRow({ participant, tournamentOpened, setupSaving, onReplace, onSetGhost, onRemove, }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(participant.displayName);
    const [saving, setSaving] = useState(false);
    async function saveReplacement(event) {
        event.preventDefault();
        const name = draft.trim();
        if (!name || setupSaving || saving)
            return;
        setSaving(true);
        const saved = await onReplace(participant.slotId, name);
        setSaving(false);
        if (saved)
            setEditing(false);
    }
    async function markGhost() {
        if (tournamentOpened || setupSaving || saving || participant.ghost)
            return;
        setSaving(true);
        await onSetGhost(participant.slotId);
        setSaving(false);
    }
    async function remove() {
        if (tournamentOpened || setupSaving || saving)
            return;
        setSaving(true);
        await onRemove(participant.slotId);
        setSaving(false);
    }
    return (<li className={`rounded-2xl px-3 py-3 ${participant.ghost ? "bg-slate-950 ring-1 ring-amber-300/30" : "bg-slate-900"}`}>
      <div className="flex items-center gap-3">
        <span className="w-10 shrink-0 text-lg font-black tabular-nums text-cyan-200">{participant.bibNumber}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${participant.ghost ? "text-amber-100" : ""}`}>
            {participant.ghost ? "Пустой слот" : participant.displayName}
          </span>
          {participant.ghost && (<span className="mt-0.5 block text-xs font-bold tracking-wide text-amber-200/80 uppercase">
              Ghost · {participant.displayName}
            </span>)}
        </span>
      </div>
      {editing && !setupSaving ? (<form className="mt-3 flex gap-2" onSubmit={(event) => void saveReplacement(event)}>
          <input className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300" value={draft} aria-label={`Новое имя вместо ${participant.displayName}`} disabled={saving} autoFocus onChange={(event) => setDraft(event.target.value)}/>
          <button type="submit" className="h-10 shrink-0 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" disabled={saving || draft.trim().length === 0}>
            Сохранить
          </button>
          <button type="button" className="h-10 shrink-0 rounded-xl border border-white/10 px-3 text-xs font-bold text-slate-300" disabled={saving} onClick={() => {
                setDraft(participant.displayName);
                setEditing(false);
            }}>
            Отмена
          </button>
        </form>) : (<div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" className="h-10 rounded-xl border border-cyan-300/40 bg-cyan-300/10 text-xs font-bold text-cyan-100 disabled:opacity-40" disabled={setupSaving || saving || (tournamentOpened && participant.ghost)} onClick={() => {
                setDraft(participant.displayName);
                setEditing(true);
            }}>
            Заменить
          </button>
          <button type="button" className="h-10 rounded-xl border border-amber-300/40 bg-amber-300/10 text-xs font-bold text-amber-100 disabled:opacity-40" disabled={tournamentOpened || setupSaving || saving || participant.ghost} onClick={() => void markGhost()}>
            Не пришел
          </button>
          <button type="button" className="h-10 rounded-xl border border-rose-300/40 bg-rose-400/10 text-xs font-bold text-rose-100 disabled:opacity-40" disabled={tournamentOpened || setupSaving || saving} onClick={() => void remove()}>
            Удалить
          </button>
        </div>)}
    </li>);
}
function PeriodPlan({ participants, sectorCount, matrix, waiting, }) {
    const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
    return (<div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
      <h3 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Период 1</h3>
      {matrix.length === 0 ? (<p className="mt-3 text-sm text-slate-400">Пары появятся, когда в листе будет хотя бы один участник.</p>) : (<ul className="mt-3 grid gap-2">
          {matrix.map((duel) => (<li key={duel.sectorId} className="rounded-2xl bg-slate-900 px-3 py-3 text-sm">
              <p className="font-black text-cyan-200">Сектор {duel.sectorId}</p>
              {duel.kind === "pair" ? (<p className="mt-1 text-slate-100">
                  {labelOf(byId, duel.leftSlotId)} слева
                  <span className="text-slate-500"> · </span>
                  {labelOf(byId, duel.rightSlotId)} справа
                </p>) : (<LoneLine participants={participants} sectorCount={sectorCount} byId={byId} slotId={duel.loneSlotId}/>)}
            </li>))}
        </ul>)}
      {waiting.length > 0 && (<p className="mt-3 text-sm text-amber-200">
          Не попали в период 1: {waiting.map((participant) => `${participant.bibNumber}. ${participant.displayName}`).join(", ")}.
          Секторов меньше, чем нужно на всех.
        </p>)}
    </div>);
}
function LoneLine({ participants, sectorCount, byId, slotId, }) {
    const neighborId = loneNeighborSlotId(participants, sectorCount, slotId);
    const vacant = ghostSeatPartner(participants, sectorCount, slotId) !== null;
    return (<p className="mt-1 text-slate-100">
      {labelOf(byId, slotId)}
      {vacant ? " · пустой слот" : " без пары"}
      {neighborId && (<>
          <span className="text-slate-500"> · </span>
          сравнение с соседом {labelOf(byId, neighborId)}
        </>)}
    </p>);
}
function labelOf(byId, slotId) {
    const participant = byId.get(slotId);
    if (!participant)
        return slotId;
    return `${participant.bibNumber}. ${participant.displayName}`;
}
