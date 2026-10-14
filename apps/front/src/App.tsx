import { useEffect, useState } from "react";
import { ArchivePage } from "./components/ArchivePage.tsx";
import { AthleteQrButton } from "./components/AthleteQrButton.tsx";
import { DrawScanner } from "./components/DrawScanner.tsx";
import { Leaderboard } from "./components/Leaderboard.tsx";
import { PlayoffEntryDialog, playoffStageTitle } from "./components/PlayoffBracket.tsx";
import { QrIntake } from "./components/QrIntake.tsx";
import { Toaster } from "./components/Toaster.tsx";
import { TournamentHistory } from "./components/TournamentHistory.tsx";
import { TournamentInit } from "./components/TournamentInit.tsx";
import { registerOnline } from "./onlineRoster.ts";
import { registerAppShell } from "./pwa.ts";
import { fetchMatchSync } from "./matchSync.ts";
import { primeScanBeep } from "./scanBeep.ts";
import { isRealAthleteName, useMatchStore } from "./store.ts";
import { confirmAndToast, toast } from "./toast.ts";
import { playoffMatches } from "../../../packages/shared/src/calculator.ts";
import { QUALIFYING_PERIODS } from "../../../packages/shared/src/types.ts";

const ORGANIZER_SEGMENT = "admin-secret-setup";
const OUTBOX_FLUSH_MS = 45_000;
const MATCH_SYNC_MS = 30_000;

type Surface = "player" | "organizer";
type OrganizerTab = "setup" | "scan" | "table" | "history";

/** Игрок открывает `/` или `#/`. Организатор — путь или хэш `admin-secret-setup`, чтобы офлайн-PWA не зависела от сервера. */
function readSurface(location: Pick<Location, "pathname" | "hash">): Surface {
  const hashPath = location.hash.replace(/^#/, "").replace(/^\/+/, "").split(/[/?#]/)[0] ?? "";
  const segments = location.pathname.split("/").filter(Boolean);
  if (hashPath === ORGANIZER_SEGMENT || segments.includes(ORGANIZER_SEGMENT)) return "organizer";
  return "player";
}

function useSurface(): Surface {
  const [surface, setSurface] = useState(() => readSurface(window.location));
  useEffect(() => {
    const sync = () => setSurface(readSurface(window.location));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return surface;
}

function readArchiveId(location: Pick<Location, "pathname" | "hash">): string | null {
  const pathMatch = /^\/archive\/([^/?#]+)\/?$/.exec(location.pathname);
  const hash = location.hash.replace(/^#/, "");
  const hashMatch = /^\/archive\/([^/?#]+)\/?$/.exec(hash);
  const raw = pathMatch?.[1] ?? hashMatch?.[1];
  if (!raw) return null;
  try {
    const id = decodeURIComponent(raw);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

function useArchiveId(): string | null {
  const [id, setId] = useState(() => readArchiveId(window.location));
  useEffect(() => {
    const sync = () => setId(readArchiveId(window.location));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return id;
}

function App() {
  const surface = useSurface();
  const archiveId = useArchiveId();
  const hydrate = useMatchStore((state) => state.hydrate);

  useEffect(() => {
    registerAppShell();
  }, []);

  useEffect(() => {
    let alive = true;
    // Сначала журнал IndexedDB: сетка, период и подтверждённые поимки. Экран ждёт hydrated.
    void hydrate().then(() => {
      if (!alive) return;
      const message = useMatchStore.getState().setupError;
      if (message) toast("err", message);
    });
    return () => {
      alive = false;
    };
  }, [hydrate]);

  useEffect(() => {
    if (archiveId) return;
    const flush = () => {
      void useMatchStore.getState().flushOutbox().then((result) => {
        if (result.sent > 0) toast("ok", "Результат синхронизирован по сети");
      });
    };
    window.addEventListener("online", flush);
    const timer = window.setInterval(flush, OUTBOX_FLUSH_MS);
    return () => {
      window.removeEventListener("online", flush);
      window.clearInterval(timer);
    };
  }, [archiveId]);

  return (
    <>
      {archiveId ? <ArchivePage id={archiveId} /> : surface === "organizer" ? <OrganizerScreen /> : <PlayerScreen />}
      <Toaster />
    </>
  );
}

async function takePlayoffGrid(raw: string): Promise<string | null> {
  const result = await useMatchStore.getState().acceptPlayoffGrid(raw);
  if (!result.ok) {
    toast("err", result.error);
    return result.error;
  }
  toast("ok", result.label);
  return null;
}

async function takeOrganizerCode(raw: string): Promise<string | null> {
  const result = await useMatchStore.getState().acceptOrganizerCode(raw);
  if (!result.ok) {
    toast("err", result.error);
    return result.error;
  }
  toast("ok", result.fresh ? "Жеребьёвка записана" : result.label);
  return null;
}

function AdminBanner() {
  return (
    <header className="rounded-3xl bg-gradient-to-br from-[#4a0c16] to-[#8f1d2c] px-4 py-6 text-center shadow-lg ring-1 ring-red-200/25">
      <h1 className="text-3xl leading-tight font-black tracking-wide text-white uppercase sm:text-4xl">
        Панель администратора
      </h1>
    </header>
  );
}

function OrganizerScreen() {
  const [tab, setTab] = useState<OrganizerTab>("setup");
  const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
  const wide = tab === "setup" || tab === "table" || tab === "history";

  useEffect(() => {
    if (!tournamentOpened) return;
    let stop = false;
    const pull = () => {
      void fetchMatchSync().then(async (result) => {
        if (stop || !result.ok) return;
        await useMatchStore.getState().applyOnlineMatches(result.matches);
      });
    };
    pull();
    const timer = window.setInterval(pull, MATCH_SYNC_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [tournamentOpened]);

  return (
    <main
      className={`mx-auto flex min-h-dvh w-full flex-col bg-slate-950 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white sm:px-6 ${wide ? "max-w-[90rem]" : "max-w-lg"}`}
    >
      <AdminBanner />
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-900 p-1 sm:grid-cols-4" role="tablist" aria-label="Организатор">
        <TabButton active={tab === "setup"} onClick={() => setTab("setup")}>
          Настройка турнира
        </TabButton>
        <TabButton
          active={tab === "scan"}
          onClick={() => {
            primeScanBeep();
            setTab("scan");
          }}
        >
          Сканировать QR
        </TabButton>
        <TabButton active={tab === "table"} onClick={() => setTab("table")}>
          Таблица лидеров
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          История турниров
        </TabButton>
      </div>
      {tab === "setup" ? (
        <TournamentInit />
      ) : tab === "scan" ? (
        <section className="mt-4 flex flex-1 flex-col">
          <h2 className="text-lg font-black tracking-tight sm:text-2xl">Сканировать QR</h2>
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            После 8-го периода игрок сдаёт один код за весь отбор. Кубковый матч приходит строкой FTP1|номер|QF|пара=рыбы, а также SF и F: поимка сразу встаёт в сетку, и победитель проходит дальше.
          </p>
          <div className="mt-4">
            <QrIntake />
          </div>
        </section>
      ) : tab === "table" ? (
        <Leaderboard />
      ) : (
        <TournamentHistory canDelete />
      )}
      <PlayoffEntryDialog organizer />
    </main>
  );
}

function PlayerScreen() {
  const sectorLabel = useMatchStore((state) => state.sectorLabel);
  const sideLabel = useMatchStore((state) => state.sideLabel);
  const period = useMatchStore((state) => state.period);
  const athleteName = useMatchStore((state) => state.athleteName);
  const opponentName = useMatchStore((state) => state.opponentName);
  const opponentSlotId = useMatchStore((state) => state.opponentSlotId);
  const athleteFish = useMatchStore((state) => state.athleteFish);
  const opponentFish = useMatchStore((state) => state.opponentFish);
  const confirmed = useMatchStore((state) => state.confirmed);
  const saving = useMatchStore((state) => state.saving);
  const savedCount = useMatchStore((state) => state.savedCount);
  const error = useMatchStore((state) => state.error);
  const hydrated = useMatchStore((state) => state.hydrated);
  const tournamentOpened = useMatchStore((state) => state.tournamentOpened);
  const adjustFish = useMatchStore((state) => state.adjustFish);
  const confirmPeriod = useMatchStore((state) => state.confirmPeriod);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-slate-950 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white sm:px-6">
      <header className="rounded-3xl border border-emerald-400/25 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950 px-4 py-5 text-center shadow-lg">
        <h1 className="text-2xl leading-tight font-black tracking-wide text-emerald-200 uppercase sm:text-3xl">
          Карточка участника
        </h1>
        <button
          type="button"
          className="mt-3 rounded-full border border-emerald-300/30 px-3 py-2 text-xs font-black text-emerald-100"
          onClick={() => setHistoryOpen((open) => !open)}
        >
          {historyOpen ? "К турниру" : "История турниров"}
        </button>
      </header>
      {historyOpen ? (
        <TournamentHistory canDelete={false} />
      ) : !hydrated ? (
        <p className="mt-4 text-sm text-slate-400">Читаем журнал…</p>
      ) : tournamentOpened ? (
        <>
        <ConnectedTournament />
        <JudgeScreen
          sectorLabel={sectorLabel}
          sideLabel={sideLabel}
          period={period}
          athleteName={athleteName}
          opponentName={opponentName}
          athleteFish={athleteFish}
          opponentFish={opponentFish}
          hasOpponent={opponentSlotId.length > 0}
          tournamentOpened={tournamentOpened}
          confirmed={confirmed}
          saving={saving}
          savedCount={savedCount}
          error={error}
          adjustFish={adjustFish}
          confirmPeriod={confirmPeriod}
        />
        </>
      ) : (
        <AwaitingDraw />
      )}
      <PlayoffEntryDialog />
    </main>
  );
}

function ConnectedTournament() {
  const tournamentName = useMatchStore((state) => state.tournamentName);
  const tournamentDate = useMatchStore((state) => state.tournamentDate);
  return (
    <section className="mb-4 rounded-3xl bg-gradient-to-br from-emerald-300 to-teal-500 px-5 py-4 text-slate-950 shadow-lg">
      <p className="text-lg leading-snug font-black">Успешно подключен к турниру: {tournamentName}</p>
      <p className="mt-1 text-base font-bold">Дата: {formatTournamentDate(tournamentDate)}</p>
    </section>
  );
}

function formatTournamentDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || "—";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function AwaitingDraw() {
  const [scanning, setScanning] = useState(false);

  if (scanning) {
    return (
      <DrawScanner
        title="Жеребьёвка организатора"
        hint="Наведите камеру на стартовый QR с ноутбука орга."
        onCode={takeOrganizerCode}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <section className="mt-4 flex flex-1 flex-col">
      <PreRegistration />
      <div className="mt-6">
        <h1 className="text-2xl font-black tracking-tight">Турнир ещё не на этом телефоне</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Сканируйте стартовый QR с ноутбука организатора. Сетка Бергера запишется в телефон, и сразу откроется ввод поимок.
        </p>
        <button
          type="button"
          className="mt-6 h-16 w-full rounded-2xl bg-cyan-300 text-lg font-black text-slate-950"
          onClick={() => setScanning(true)}
        >
          Сканировать жеребьевку организатора
        </button>
      </div>
    </section>
  );
}

function PreRegistration() {
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullName = name.trim().replace(/\s+/g, " ");
  const ready = fullName.length >= 3;

  if (done) {
    return (
      <section className="rounded-3xl border border-emerald-300/40 bg-emerald-300/10 px-4 py-4" role="status">
        <h2 className="text-sm font-bold tracking-wide text-emerald-200 uppercase">Предварительная регистрация</h2>
        <p className="mt-2 text-base leading-relaxed font-semibold text-emerald-50">
          Вы успешно записаны. Утром на водоеме отсканируйте Стартовый QR-код у организатора.
        </p>
      </section>
    );
  }

  return (
    <form
      className="rounded-3xl bg-slate-900 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || sending) {
          setError("Введите ваше ФИО");
          return;
        }
        setSending(true);
        setError(null);
        void registerOnline(fullName).then((result) => {
          setSending(false);
          if (!result.ok) {
            setError(result.error);
            toast("err", result.error);
            return;
          }
          setDone(true);
        });
      }}
    >
      <h2 className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Предварительная регистрация</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        Заявка уходит на сервер, пока есть интернет. На берегу турнир откроется по QR без сети.
      </p>
      <label className="mt-3 block text-sm font-bold text-slate-200" htmlFor="preregister-name">
        Введите ваше ФИО
      </label>
      <input
        id="preregister-name"
        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base font-semibold text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
        value={name}
        placeholder="Иванов Иван Иванович"
        autoComplete="name"
        required
        minLength={3}
        disabled={sending}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="submit"
        className="mt-3 h-12 w-full rounded-xl bg-cyan-300 text-sm font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
        disabled={sending || !ready}
      >
        {sending ? "Отправляем..." : "Отправить заявку"}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-rose-300">{error}</p>}
    </form>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`min-h-12 rounded-xl px-1 text-[10px] leading-tight font-black sm:px-2 sm:text-xs ${active ? "bg-cyan-300 text-slate-950" : "text-slate-300"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function JudgeScreen({
  sectorLabel,
  sideLabel,
  period,
  athleteName,
  opponentName,
  athleteFish,
  opponentFish,
  hasOpponent,
  tournamentOpened,
  confirmed,
  saving,
  savedCount,
  error,
  adjustFish,
  confirmPeriod,
}: {
  sectorLabel: string;
  sideLabel: string;
  period: number;
  athleteName: string;
  opponentName: string;
  athleteFish: number;
  opponentFish: number;
  hasOpponent: boolean;
  tournamentOpened: boolean;
  confirmed: boolean;
  saving: boolean;
  savedCount: number | null;
  error: string | null;
  adjustFish: (who: "athlete" | "opponent", delta: 1 | -1) => void;
  confirmPeriod: () => Promise<void>;
}) {
  const participants = useMatchStore((state) => state.participants);
  const syncNote = useMatchStore((state) => state.syncNote);
  const athleteSlotId = useMatchStore((state) => state.athleteSlotId);
  const selfSlotId = useMatchStore((state) => state.selfSlotId);
  const briefing = useMatchStore((state) => state.briefing);
  const neighborLabel = useMatchStore((state) => state.neighborLabel);
  const selectAthlete = useMatchStore((state) => state.selectAthlete);
  const playoff = useMatchStore((state) => state.playoff);
  const selectedPlayoffMatchId = useMatchStore((state) => state.selectedPlayoffMatchId);
  const playoffEntryOpen = useMatchStore((state) => state.playoffEntryOpen);
  const openPlayoffEntry = useMatchStore((state) => state.openPlayoffEntry);
  const closePlayoffEntry = useMatchStore((state) => state.closePlayoffEntry);
  const qualifyingHandoffReady = useMatchStore((state) => state.qualifyingHandoffReady);
  const [cupScan, setCupScan] = useState(false);
  const playoffFormed = playoff.formed;
  const playerNamedSlotIds = useMatchStore((state) => state.playerNamedSlotIds);
  const identitySlotId = playoffFormed ? selfSlotId : athleteSlotId;
  const identity = participants.find((participant) => participant.slotId === identitySlotId);
  const nameReady =
    identity !== undefined &&
    playerNamedSlotIds.includes(identity.slotId) &&
    isRealAthleteName(identity.displayName, identity.bibNumber);
  const locked =
    !tournamentOpened || saving || athleteSlotId.length === 0 || (!playoffFormed && (confirmed || !nameReady));
  const fishing = participants.filter((participant) => !participant.ghost);
  const alone = tournamentOpened && !playoffFormed && athleteSlotId.length > 0 && !hasOpponent;
  const cupMatches = playoffMatches(playoff);
  const nameOf = (slotId: string | null) => {
    if (!slotId) return "ожидается";
    const person = participants.find((participant) => participant.slotId === slotId);
    return person ? `${person.bibNumber}. ${person.displayName}` : "—";
  };

  return (
    <>
      {tournamentOpened && !playoffFormed && (
        <div className="mt-4 grid grid-cols-8 gap-1" role="group" aria-label="Период отбора">
          {QUALIFYING_PERIODS.map((item) => (
            <button
              key={item}
              type="button"
              className={`h-10 rounded-xl text-sm font-black ${item === period ? "bg-cyan-300 text-slate-950" : "bg-slate-900 text-slate-300"}`}
              onClick={() => {
                if (item === period) return;
                void useMatchStore.getState().signalPeriod(item, useMatchStore.getState().periodPhase).then((ok) => {
                  if (ok) toast("ok", `Период ${item}`);
                  else toast("err", useMatchStore.getState().error ?? "Не удалось сменить период");
                });
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      <PeriodStatus playoffFormed={playoffFormed} period={period} />

      {!playoffFormed && qualifyingHandoffReady && (
        <div className="mt-4">
          {cupScan ? (
            <DrawScanner
              title="Сетка Плей-офф"
              hint="Наведите камеру на стартовый QR плей-офф с ноутбука организатора."
              placeholder="FTPC1.…"
              onCode={takePlayoffGrid}
              onClose={() => setCupScan(false)}
            />
          ) : (
            <>
              <button
                type="button"
                className="h-16 w-full rounded-2xl bg-cyan-300 text-lg font-black text-slate-950"
                onClick={() => {
                  primeScanBeep();
                  setCupScan(true);
                }}
              >
                Сканировать сетку Плей-офф
              </button>
              <p className="mt-2 text-center text-sm leading-relaxed text-slate-300">
                8 периодов отбора закрыты. Код с ноутбука орга запишет топ-8 и пары 1/4 в этот телефон.
              </p>
            </>
          )}
        </div>
      )}

      {playoffFormed && (
        <>
        <label className="mt-4 block rounded-3xl bg-slate-900 px-4 py-4" htmlFor="playoff-match">
          <span className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Кубковая пара</span>
          <select
            id="playoff-match"
            className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base font-semibold text-white outline-none focus:border-cyan-300 disabled:opacity-50"
            value={selectedPlayoffMatchId}
            disabled={saving}
            onChange={(event) => {
              const matchId = event.target.value;
              if (!matchId) {
                closePlayoffEntry();
                return;
              }
              openPlayoffEntry(matchId);
            }}
          >
            <option value="">Выберите пару</option>
            {cupMatches.map((match) => (
              <option key={match.matchId} value={match.matchId} disabled={!match.slotIdA || !match.slotIdB}>
                {playoffStageTitle(match.stage)}: {nameOf(match.slotIdA)} — {nameOf(match.slotIdB)}
              </option>
            ))}
          </select>
        </label>
        {selectedPlayoffMatchId && !playoffEntryOpen && (
          <button
            type="button"
            className="mt-3 h-12 w-full rounded-xl bg-cyan-300 text-sm font-black text-slate-950 disabled:opacity-40"
            disabled={saving}
            onClick={() => openPlayoffEntry(selectedPlayoffMatchId)}
          >
            Ввести поимки
          </button>
        )}
        </>
      )}

      {tournamentOpened && (
        <div className="mt-4 rounded-3xl bg-slate-900 px-4 py-4">
          <label className="block" htmlFor="athlete-number">
          <span className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase">Ваш номер</span>
          {playoffFormed && (
            <span className="mt-1 block text-xs font-semibold tracking-normal text-slate-400 normal-case">
              В QR попадёт счёт этого номера в выбранной паре.
            </span>
          )}
          <select
            id="athlete-number"
            className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base font-semibold text-white outline-none focus:border-cyan-300 disabled:opacity-50"
            value={playoffFormed ? selfSlotId : athleteSlotId}
            disabled={saving}
            onChange={(event) => {
              selectAthlete(event.target.value);
              const message = useMatchStore.getState().error;
              if (message) toast("err", message);
            }}
          >
            <option value="">Выберите номер</option>
            {fishing.map((participant) => (
              <option key={participant.slotId} value={participant.slotId}>
                №{participant.bibNumber} · {participant.displayName}
              </option>
            ))}
          </select>
          </label>
          {identitySlotId && (
            <AthleteNameField
              key={identitySlotId}
              slotId={identitySlotId}
              saved={nameReady}
              editable={!playoffFormed}
            />
          )}
        </div>
      )}

      <header className="mt-4 rounded-3xl bg-gradient-to-br from-cyan-400 to-teal-700 px-5 py-6 text-slate-950 shadow-lg">
        <p className="text-sm font-semibold tracking-[0.2em] uppercase">{playoffFormed ? "Плей-офф" : "Сектор"}</p>
        <p className="mt-1 text-6xl leading-none font-black tracking-tight">{sectorLabel}</p>
        {athleteSlotId && !playoffFormed && (
          <p className="mt-3 inline-flex rounded-full bg-slate-950 px-4 py-2 text-2xl font-black tracking-wide text-cyan-200">
            {sideLabel}
          </p>
        )}
        {briefing ? (
          <p className="mt-4 text-base leading-snug font-bold">{briefing}</p>
        ) : (
          tournamentOpened && (
            <p className="mt-4 text-base leading-snug font-bold">
              Выберите номер — сектор и соперник подставятся из сетки.
            </p>
          )
        )}
      </header>

      <section className="mt-4 grid flex-1 gap-4">
        <ScoreCard
          title={athleteName}
          count={athleteFish}
          disabled={locked}
          onPlus={() => adjustFish("athlete", 1)}
          onMinus={() => adjustFish("athlete", -1)}
        />
        {alone ? (
          <LoneNeighborNotice label={neighborLabel} />
        ) : (
          <ScoreCard
            title={opponentName}
            count={opponentFish}
            disabled={locked || !hasOpponent}
            onPlus={() => adjustFish("opponent", 1)}
            onMinus={() => adjustFish("opponent", -1)}
          />
        )}
      </section>

      <div className="sticky bottom-0 mt-4 bg-gradient-to-t from-slate-950 via-slate-950 to-slate-950/0 pt-3">
        <button
          type="button"
          className="h-16 w-full rounded-2xl bg-amber-400 text-lg font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
          disabled={locked || confirmed || !nameReady || identitySlotId.length === 0}
          onClick={() => void confirmAndToast(confirmPeriod)}
        >
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
        {savedCount !== null && (
          <p className="mt-2 text-center text-sm text-emerald-300">В IndexedDB записано событий: {savedCount}</p>
        )}
        {syncNote && <p className="mt-2 text-center text-sm text-emerald-300">{syncNote}</p>}
        {error && <p className="mt-2 text-center text-sm text-rose-300">{error}</p>}
        <AthleteQrButton />
      </div>
    </>
  );
}

function AthleteNameField({
  slotId,
  saved,
  editable,
}: {
  slotId: string;
  saved: boolean;
  editable: boolean;
}) {
  const participant = useMatchStore((state) => state.participants.find((item) => item.slotId === slotId));
  const replaceParticipant = useMatchStore((state) => state.replaceParticipant);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!participant) return null;
  if (saved && !editing) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-lg font-black text-white">
          №{participant.bibNumber} · {participant.displayName}
        </p>
        {editable && (
          <button
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-slate-950 text-cyan-200"
            aria-label="Редактировать ФИО"
            onClick={() => {
              setDraft(participant.displayName);
              setError(null);
              setEditing(true);
            }}
          >
            <PencilIcon />
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim().replace(/\s+/g, " ");
        if (!isRealAthleteName(name, participant.bibNumber)) {
          setError("Введите ФИО");
          toast("err", "Введите ФИО");
          return;
        }
        setBusy(true);
        setError(null);
        void replaceParticipant(slotId, name).then((ok) => {
          setBusy(false);
          if (!ok) {
            setError("Не удалось записать ФИО");
            toast("err", "Не удалось записать ФИО");
            return;
          }
          setEditing(false);
          toast("ok", "ФИО сохранено");
        });
      }}
    >
      <label className="text-sm font-bold tracking-wide text-cyan-100/80 uppercase" htmlFor="athlete-name">
        ФИО
      </label>
      <input
        id="athlete-name"
        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-base font-semibold text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
        value={draft}
        placeholder="Иванов Иван Иванович"
        autoComplete="name"
        required
        minLength={3}
        aria-required="true"
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Номер и ФИО остаются на телефоне и уходят организатору после 8-го периода.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          className="h-12 flex-1 rounded-xl bg-cyan-300 text-sm font-black text-slate-950 disabled:opacity-40"
          disabled={busy || !isRealAthleteName(draft, participant.bibNumber)}
        >
          {busy ? "Записываем…" : "Сохранить ФИО"}
        </button>
        {editing && (
          <button
            type="button"
            className="h-12 rounded-xl border border-white/10 px-4 text-sm font-black text-slate-200 disabled:opacity-40"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Отмена
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-rose-300">{error}</p>}
    </form>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
    </svg>
  );
}

function PeriodStatus({ playoffFormed, period }: { playoffFormed: boolean; period: number }) {
  if (playoffFormed) {
    return (
      <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-6 text-center" aria-live="polite">
        <p className="text-4xl font-black tracking-tight">ПЛЕЙ-ОФФ</p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-center" aria-live="polite">
      <p className="text-xs font-bold tracking-[0.2em] text-cyan-100/80 uppercase">Период</p>
      <p className="text-5xl leading-none font-black tabular-nums">{period}</p>
    </section>
  );
}

function LoneNeighborNotice({ label }: { label: string }) {
  return (
    <aside className="rounded-3xl border-2 border-amber-200 bg-amber-300 px-4 py-5 text-slate-950 shadow-lg" role="status">
      <p className="text-sm font-black tracking-[0.16em] uppercase">Внимание</p>
      <p className="mt-2 text-lg leading-snug font-black">
        Вы ловите в секторе один. Ваш результат в этом периоде напрямую сравнивается с уловом соседа из соседнего сектора: {label}.
      </p>
    </aside>
  );
}

function ScoreCard({
  title,
  count,
  disabled,
  onPlus,
  onMinus,
}: {
  title: string;
  count: number;
  disabled: boolean;
  onPlus: () => void;
  onMinus: () => void;
}) {
  return (
    <article className="rounded-3xl bg-slate-900 px-4 py-4">
      <div className="flex items-end justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-xl leading-tight font-bold">{title}</h2>
        <p className="text-5xl leading-none font-black tabular-nums">{count}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="h-24 rounded-2xl bg-emerald-400 text-2xl font-black tracking-wide text-slate-950 active:bg-emerald-300 disabled:opacity-40"
          disabled={disabled}
          onClick={onPlus}
        >
          ПЛЮС
        </button>
        <button
          type="button"
          className="h-24 rounded-2xl bg-rose-500 text-2xl font-black tracking-wide text-white active:bg-rose-400 disabled:opacity-40"
          disabled={disabled || count === 0}
          onClick={onMinus}
        >
          МИНУС
        </button>
      </div>
    </article>
  );
}

export default App;
