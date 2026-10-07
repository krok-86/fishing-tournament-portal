import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { GridSlot, PeriodIndex } from "../../../../packages/shared/src/types.ts";
import { encodeStartSnapshot, periodStatusLabel, seatsFromGrid, type StartSnapshot } from "../qrSync.ts";
import {
  scheduleGrid,
  sectorsForPeriod,
  useMatchStore,
  type PeriodSector,
  type RegisteredParticipant,
} from "../store.ts";
import { toast } from "../toast.ts";

export function TournamentInit() {
  const participants = useMatchStore((state) => state.participants);
  const sectorCount = useMatchStore((state) => state.sectorCount);
  const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
  const setupSaving = useMatchStore((state) => state.setupSaving);
  const setupError = useMatchStore((state) => state.setupError);
  const hydrated = useMatchStore((state) => state.hydrated);
  const registerParticipant = useMatchStore((state) => state.registerParticipant);
  const seedNumberedStart = useMatchStore((state) => state.seedNumberedStart);
  const replaceParticipant = useMatchStore((state) => state.replaceParticipant);
  const removeParticipant = useMatchStore((state) => state.removeParticipant);
  const clearParticipants = useMatchStore((state) => state.clearParticipants);
  const startTournament = useMatchStore((state) => state.startTournament);
  const resetTournament = useMatchStore((state) => state.resetTournament);
  const tournamentName = useMatchStore((state) => state.tournamentName);
  const tournamentDate = useMatchStore((state) => state.tournamentDate);
  const grid = useMatchStore((state) => state.grid);
  const periodsCount = useMatchStore((state) => state.periodsCount);
  const previewGrid = useMemo(
    () => scheduleGrid(participants, periodsCount),
    [participants, periodsCount],
  );
  const drawGrid = tournamentOpened ? grid : previewGrid;
  const [draft, setDraft] = useState("");
  const [arrivalCount, setArrivalCount] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso);
  const [opening, setOpening] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const seedLock = useRef(false);

  const locked = tournamentOpened || setupSaving;
  const parsedArrival = Number.parseInt(arrivalCount, 10);
  const arrivalReady = Number.isInteger(parsedArrival) && parsedArrival >= 2 && participants.length === 0;

  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || locked) return;
    const saved = await registerParticipant(name);
    if (saved) {
      setDraft("");
      toast("ok", `${name} добавлен`);
    } else {
      toast("err", useMatchStore.getState().setupError ?? "Не удалось добавить участника");
    }
  }

  async function seedNumbers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || participants.length > 0 || seedLock.current) return;
    seedLock.current = true;
    const field = event.currentTarget.elements.namedItem("arrival");
    const typed = field instanceof HTMLInputElement ? field.value.trim() : "";
    const count = Number.parseInt(typed || arrivalCount.trim(), 10);
    try {
      if (!Number.isInteger(count) || count < 2) {
        await seedNumberedStart(Number.isFinite(count) ? count : 0);
        toast("err", useMatchStore.getState().setupError ?? "Укажите число рыбаков от 2");
        return;
      }
      setSeeding(true);
      const saved = await seedNumberedStart(count);
      if (saved) {
        setArrivalCount("");
        toast("ok", `Создано номеров: ${count}`);
        document.getElementById("starter-list")?.scrollIntoView({ block: "nearest" });
      } else {
        toast("err", useMatchStore.getState().setupError ?? "Не удалось создать номера");
      }
    } finally {
      seedLock.current = false;
      setSeeding(false);
    }
  }

  async function clearList() {
    if (locked || participants.length === 0) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    const cleared = await clearParticipants();
    if (cleared) toast("ok", "Стартовый лист очищен");
    else toast("err", useMatchStore.getState().setupError ?? "Не удалось очистить лист");
  }

  async function open() {
    const trimmedName = name.trim();
    setOpening(true);
    const started = await startTournament({ name: trimmedName, date });
    setOpening(false);
    if (started) {
      toast("ok", `Турнир «${trimmedName}» открыт`);
      requestAnimationFrame(() => {
        document.getElementById("start-qr")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      toast("err", useMatchStore.getState().setupError ?? "Не удалось открыть турнир");
    }
  }

  async function resetAll() {
    if (setupSaving) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const cleared = await resetTournament();
    if (cleared) {
      setDraft("");
      setArrivalCount("");
      setName("");
      setDate(todayIso());
      toast("ok", "Турнир сброшен");
    } else {
      toast("err", useMatchStore.getState().setupError ?? "Не удалось сбросить турнир");
    }
  }

  if (!hydrated) {
    return (
      <section className="mt-4">
        <h2 className="text-lg font-black tracking-tight sm:text-2xl">Настройка турнира</h2>
        <p className="mt-3 text-sm text-slate-400">Читаем журнал…</p>
      </section>
    );
  }

  return (
    <section className="mt-4 flex flex-1 flex-col gap-4">
      <header>
        <h2 className="text-lg font-black tracking-tight sm:text-2xl">Настройка турнира</h2>
        <p className="mt-1 text-xs text-slate-400 sm:text-sm">
          До открытия турнира номер — это место в списке. Удаление убирает строку и сдвигает номера: 1, 2, 3 без пропусков. «Заменить» меняет только имя.
        </p>
      </header>

      <div className="rounded-3xl bg-slate-900 px-4 py-4">
        <label className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase" htmlFor="tournament-name">
          Название турнира
        </label>
        <input
          id="tournament-name"
          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:opacity-50"
          value={tournamentOpened ? tournamentName : name}
          placeholder="Trout Cup"
          disabled={locked}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="mt-4 block text-sm font-bold tracking-wide text-cyan-100/80 uppercase" htmlFor="tournament-date">
          Дата проведения
        </label>
        <input
          id="tournament-date"
          className="scheme-dark mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base text-white outline-none focus:border-cyan-300 disabled:opacity-50"
          type="date"
          value={tournamentOpened ? tournamentDate : date}
          disabled={locked}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      {tournamentOpened && (
        <p className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-semibold text-emerald-200">
          Турнир открыт. Сетка на {periodsCount} периодов записана. На вводе результатов выберите свой номер.
        </p>
      )}

      <form
        className="rounded-3xl bg-slate-900 px-4 py-4"
        noValidate
        onSubmit={(event) => void seedNumbers(event)}
      >
        <h3 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Быстрый старт по номерам</h3>
        <p className="mt-2 text-sm text-slate-400">
          Сколько рыбаков приехало. Система создаст «Спортсмен №1», «Спортсмен №2» и дальше по списку.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            id="arrival-count"
            name="arrival"
            className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:opacity-50"
            inputMode="numeric"
            min={2}
            step={1}
            type="number"
            value={arrivalCount}
            placeholder="2–200"
            aria-label="Число приехавших рыбаков"
            disabled={locked || participants.length > 0 || seeding}
            onChange={(event) => setArrivalCount(event.target.value)}
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
            disabled={locked || participants.length > 0 || seeding}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              // Иначе уход фокуса из поля числа отменяет клик, и «Создать 9» молча ничего не делает.
              event.preventDefault();
            }}
          >
            {seeding ? "Создаём..." : arrivalReady ? `Создать ${parsedArrival}` : "Создать номера"}
          </button>
        </div>
        {setupError && participants.length === 0 && (
          <p className="mt-3 text-sm text-rose-300">{setupError}</p>
        )}
        {participants.length > 0 && !tournamentOpened && (
          <div className="mt-3 grid gap-2">
            <p className="text-sm text-amber-200">
              Быстрый старт ждёт пустой лист: участники уже вписаны. Удалите лишних или очистите лист и соберите номера заново.
            </p>
            <button
              type="button"
              className="h-10 rounded-xl border border-rose-300/40 bg-rose-400/10 text-xs font-bold text-rose-100 disabled:opacity-40"
              disabled={setupSaving}
              onClick={() => void clearList()}
            >
              {confirmClear ? "Точно очистить лист" : "Очистить лист"}
            </button>
          </div>
        )}
      </form>

      <form className="rounded-3xl bg-slate-900 px-4 py-4" onSubmit={(event) => void addParticipant(event)}>
        <label className="text-sm font-bold text-slate-200" htmlFor="participant-name">
          Участник
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="participant-name"
            className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:opacity-50"
            value={draft}
            placeholder="Имя и Enter"
            disabled={locked}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
            disabled={locked || draft.trim().length === 0}
          >
            Добавить
          </button>
        </div>
      </form>

      <ParticipantList
        participants={participants}
        tournamentOpened={tournamentOpened}
        setupSaving={setupSaving}
        onReplace={replaceParticipant}
        onRemove={removeParticipant}
      />

      <p className="rounded-3xl bg-slate-900 px-4 py-4 text-sm font-bold text-slate-200">
        Секторов на водоёме потребуется: <span className="tabular-nums text-cyan-200">{sectorCount}</span>
      </p>

      <PeriodPlan participants={participants} grid={drawGrid} periodsCount={periodsCount} />

      <button
        type="button"
        className="h-16 rounded-2xl bg-amber-400 text-lg font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
        disabled={tournamentOpened || setupSaving || participants.length < 2 || name.trim().length === 0 || date.length === 0}
        onClick={() => void open()}
      >
        {opening ? "Сохраняем..." : tournamentOpened ? "Турнир открыт" : "Открыть турнир"}
      </button>
      {tournamentOpened && <StartQrCard />}
      <button
        type="button"
        className={`h-12 rounded-2xl text-sm font-black disabled:opacity-40 ${
          confirmReset
            ? "border border-rose-300/40 bg-rose-500 text-white"
            : "bg-amber-400 text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
        }`}
        disabled={setupSaving}
        onClick={() => void resetAll()}
      >
        {confirmReset ? "Точно сбросить всё" : "Сбросить всё (Hard Reset)"}
      </button>
      {setupError && <p className="text-center text-sm text-rose-300">{setupError}</p>}
    </section>
  );
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function StartQrCard() {
  const participants = useMatchStore((state) => state.participants);
  const grid = useMatchStore((state) => state.grid);
  const periodsCount = useMatchStore((state) => state.periodsCount);
  const sectorCount = useMatchStore((state) => state.sectorCount);
  const period = useMatchStore((state) => state.period);
  const phase = useMatchStore((state) => state.periodPhase);
  const tournamentName = useMatchStore((state) => state.tournamentName);
  const tournamentDate = useMatchStore((state) => state.tournamentDate);
  const snapshot = useMemo<StartSnapshot>(
    () => ({
      periodsPerRound: periodsCount,
      sectorCount,
      period,
      phase,
      tournamentName,
      tournamentDate,
      participants: participants.map((participant) => ({
        bibNumber: participant.bibNumber,
        displayName: participant.displayName,
        groupId: participant.groupId,
        ghost: participant.ghost,
      })),
      seats: seatsFromGrid(
        grid,
        new Map(participants.map((participant) => [participant.slotId, participant.bibNumber])),
      ),
    }),
    [participants, grid, periodsCount, sectorCount, period, phase, tournamentName, tournamentDate],
  );
  const plain = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const [packet, setPacket] = useState<{ key: string; payload: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payload = packet?.key === plain ? packet.payload : null;

  useEffect(() => {
    let cancelled = false;
    void encodeStartSnapshot(snapshot)
      .then((value) => {
        if (!cancelled) {
          setPacket({ key: plain, payload: value });
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Не удалось сжать сетку в QR");
          toast("err", "Не удалось сжать сетку в QR");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, plain]);

  const tooWide = payload !== null && payload.length > 2800;

  return (
    <div id="start-qr" className="rounded-3xl border border-cyan-300/30 bg-slate-900 px-4 py-4">
      <h3 className="text-lg font-black tracking-tight">Стартовый QR-код турнира</h3>
      <p className="mt-2 text-sm text-slate-300">
        В коде сжатая сетка Бергера и стартовый лист. Игрок сканирует его один раз — телефон записывает жеребьёвку и открывает ввод поимок.
      </p>
      <p className="mt-2 text-sm font-bold text-cyan-100">{periodStatusLabel(period, phase)}</p>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      {!payload && !error && <p className="mt-3 text-sm text-slate-400">Собираем код…</p>}
      {payload && tooWide && (
        <p className="mt-3 text-sm text-amber-200">
          Сетка не помещается в один QR. Передайте строку ниже вручную.
        </p>
      )}
      {payload && !tooWide && (
        <div className="mx-auto mt-4 w-fit rounded-3xl bg-white p-3">
          <QRCodeSVG
            value={payload}
            size={300}
            level="L"
            marginSize={4}
            bgColor="#ffffff"
            fgColor="#020617"
            title="Стартовый QR-код турнира"
          />
        </div>
      )}
      {payload && (
        <textarea
          className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-[11px] text-cyan-100 outline-none"
          readOnly
          rows={3}
          value={payload}
          aria-label="Сжатая строка стартового QR"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}

function ParticipantList({
  participants,
  tournamentOpened,
  setupSaving,
  onReplace,
  onRemove,
}: {
  participants: readonly RegisteredParticipant[];
  tournamentOpened: boolean;
  setupSaving: boolean;
  onReplace: (slotId: string, displayName: string) => Promise<boolean>;
  onRemove: (slotId: string) => Promise<boolean>;
}) {
  return (
    <div id="starter-list" className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Стартовый лист</h3>
          <p className="mt-1 text-xs text-slate-400">
            До старта удаление убирает строку и смыкает номера. Замена меняет только имя.
          </p>
        </div>
        <p className="text-sm font-semibold text-slate-300">{participants.length}</p>
      </div>
      {participants.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Пока никого нет. Создайте номера или введите имя.</p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {participants.map((participant) => (
            <ParticipantRow
              key={participant.slotId}
              participant={participant}
              tournamentOpened={tournamentOpened}
              setupSaving={setupSaving}
              onReplace={onReplace}
              onRemove={onRemove}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function ParticipantRow({
  participant,
  tournamentOpened,
  setupSaving,
  onReplace,
  onRemove,
}: {
  participant: RegisteredParticipant;
  tournamentOpened: boolean;
  setupSaving: boolean;
  onReplace: (slotId: string, displayName: string) => Promise<boolean>;
  onRemove: (slotId: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant.displayName);
  const [saving, setSaving] = useState(false);

  async function saveReplacement(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || setupSaving || saving) return;
    setSaving(true);
    const saved = await onReplace(participant.slotId, name);
    setSaving(false);
    if (saved) {
      setEditing(false);
      toast("ok", `№${participant.bibNumber}: имя сохранено`);
    } else {
      toast("err", useMatchStore.getState().setupError ?? "Не удалось сохранить имя");
    }
  }

  async function remove() {
    if (tournamentOpened || setupSaving || saving) return;
    setSaving(true);
    const saved = await onRemove(participant.slotId);
    setSaving(false);
    if (saved) toast("ok", `№${participant.bibNumber} удалён`);
    else toast("err", useMatchStore.getState().setupError ?? "Не удалось удалить участника");
  }

  return (
    <li className={`rounded-2xl px-3 py-3 ${participant.ghost ? "bg-slate-950 ring-1 ring-amber-300/30" : "bg-slate-900"}`}>
      <div className="flex items-center gap-3">
        <span className="w-10 shrink-0 text-lg font-black tabular-nums text-cyan-200">{participant.bibNumber}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${participant.ghost ? "text-amber-100" : ""}`}>
            {participant.ghost ? "Пустой слот" : participant.displayName}
          </span>
          {participant.ghost && (
            <span className="mt-0.5 block text-xs font-bold tracking-wide text-amber-200/80 uppercase">
              Ghost · {participant.displayName}
            </span>
          )}
        </span>
      </div>
      {editing && !setupSaving ? (
        <form className="mt-3" onSubmit={(event) => void saveReplacement(event)}>
          <p className="mb-2 text-xs font-semibold text-slate-400">
            Номер {participant.bibNumber} остаётся в сетке Бергера. Меняется только имя.
          </p>
          <div className="flex gap-2">
          <input
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
            value={draft}
            aria-label={`Новое имя вместо ${participant.displayName}`}
            disabled={saving}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="h-10 shrink-0 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
            disabled={saving || draft.trim().length === 0}
          >
            Сохранить
          </button>
          <button
            type="button"
            className="h-10 shrink-0 rounded-xl border border-white/10 px-3 text-xs font-bold text-slate-300"
            disabled={saving}
            onClick={() => {
              setDraft(participant.displayName);
              setEditing(false);
            }}
          >
            Отмена
          </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            className="h-10 rounded-xl border border-cyan-300/40 bg-cyan-300/10 text-xs font-bold text-cyan-100 disabled:opacity-40"
            disabled={setupSaving || saving || (tournamentOpened && participant.ghost)}
            onClick={() => {
              setDraft(participant.displayName);
              setEditing(true);
            }}
          >
            Заменить
          </button>
          <button
            type="button"
            className="h-10 rounded-xl border border-amber-300/40 bg-amber-300/10 text-xs font-bold text-amber-100 disabled:opacity-40"
            disabled
            title="До открытия турнира пустой слот не ставится. Лишний номер удалите."
          >
            Не пришел
          </button>
          <button
            type="button"
            className="h-10 rounded-xl border border-rose-300/40 bg-rose-400/10 text-xs font-bold text-rose-100 disabled:opacity-40"
            disabled={tournamentOpened || setupSaving || saving}
            onClick={() => void remove()}
          >
            Удалить
          </button>
        </div>
      )}
    </li>
  );
}

function PeriodPlan({
  participants,
  grid,
  periodsCount,
}: {
  participants: readonly RegisteredParticipant[];
  grid: readonly GridSlot[];
  periodsCount: number;
}) {
  const periods = useMemo(() => periodTabs(periodsCount), [periodsCount]);
  const [period, setPeriod] = useState<PeriodIndex>(1);
  const active = periods.includes(period) ? period : (periods[0] ?? 1);
  const sectors = useMemo(
    () => sectorsForPeriod(grid, participants, active),
    [grid, participants, active],
  );
  const byId = useMemo(
    () => new Map(participants.map((participant) => [participant.slotId, participant])),
    [participants],
  );
  const waiting = useMemo(() => unseated(participants, sectors), [participants, sectors]);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
      <h3 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Жеребьёвка</h3>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Периоды жеребьёвки">
        {periods.map((item) => {
          const selected = item === active;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${
                selected ? "bg-cyan-300 text-slate-950" : "bg-slate-900 text-slate-300"
              }`}
              onClick={() => setPeriod(item)}
            >
              Период {item}
            </button>
          );
        })}
      </div>
      {participants.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Пары появятся, когда в листе будет хотя бы один участник.</p>
      ) : sectors.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">В периоде {active} нет рассадки.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {sectors.map((sector) => (
            <li key={sector.sectorId} className="rounded-2xl bg-slate-900 px-3 py-3 text-sm">
              <p className="font-black text-cyan-200">Сектор {sector.sectorId}</p>
              <SectorLine sector={sector} byId={byId} />
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <p className="mt-3 text-sm text-amber-200">
          Не попали в период {active}:{" "}
          {waiting.map((participant) => `${participant.bibNumber}. ${participant.displayName}`).join(", ")}.
          Секторов меньше, чем нужно на всех.
        </p>
      )}
    </div>
  );
}

function SectorLine({
  sector,
  byId,
}: {
  sector: PeriodSector;
  byId: ReadonlyMap<string, RegisteredParticipant>;
}) {
  if (sector.kind === "pair") {
    return (
      <p className="mt-1 text-slate-100">
        {labelOf(byId, sector.leftSlotId)} слева
        <span className="text-slate-500"> · </span>
        {labelOf(byId, sector.rightSlotId)} справа
      </p>
    );
  }

  const side = sector.side === "left" ? "слева" : "справа";
  return (
    <p className="mt-1 text-slate-100">
      {labelOf(byId, sector.slotId)} {side}
      {sector.vacant ? " · пустой слот" : " без пары"}
      {sector.neighborSlotId && (
        <>
          <span className="text-slate-500"> · </span>
          сравнение с соседом {labelOf(byId, sector.neighborSlotId)}
        </>
      )}
    </p>
  );
}

function periodTabs(count: number): PeriodIndex[] {
  const total = Number.isInteger(count) && count > 0 ? Math.min(count, 10) : 8;
  return Array.from({ length: total }, (_, index) => (index + 1) as PeriodIndex);
}

function unseated(
  participants: readonly RegisteredParticipant[],
  sectors: readonly PeriodSector[],
): RegisteredParticipant[] {
  const seated = new Set<string>();
  for (const sector of sectors) {
    if (sector.kind === "pair") {
      seated.add(sector.leftSlotId);
      seated.add(sector.rightSlotId);
    } else {
      seated.add(sector.slotId);
    }
  }
  return participants.filter((participant) => !participant.ghost && !seated.has(participant.slotId));
}

function labelOf(byId: ReadonlyMap<string, RegisteredParticipant>, slotId: string): string {
  const participant = byId.get(slotId);
  if (!participant) return slotId;
  return `${participant.bibNumber}. ${participant.displayName}`;
}
