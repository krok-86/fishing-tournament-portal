import { create } from "zustand";
import {
  buildQuarterfinals,
  comparisonNeighborFromGrid,
  emptyPlayoffProjection,
  generateTournamentGrid,
  isGhostOpponent,
  playoffMatches,
  projectPlayoff,
  scorePlayoffDuel,
  seedsFromRanking,
  tournamentCalculator,
  withPlayoffDuel,
  withPlayoffReport,
} from "../../../packages/shared/src/calculator.ts";
import {
  QUALIFYING_PERIOD_COUNT,
  QUALIFYING_PERIODS,
  type FishDelta,
  type GridSlot,
  type GroupId,
  type LeaderboardEntry,
  type MatrixDuel,
  type PeriodIndex,
  type PeriodPhase,
  type PlayoffBracketMatch,
  type PlayoffProjection,
  type PlayoffSeed,
  type RoundIndex,
  type Side,
  type TournamentEvent,
  type ZoneId,
} from "../../../packages/shared/src/types.ts";
import { buildTournamentArchive } from "../../../packages/shared/src/archive.ts";
import { postTournamentArchive, type ArchivePostResult } from "./archiveApi.ts";
import { db, type DuelConflictRecord, type EventRecord, type OutboxItem } from "./db.ts";
import { postMatchReport, type SyncMatch } from "./matchSync.ts";
import {
  decodeCatchSnapshot,
  decodePeriodSignal,
  decodePlayoffGrid,
  decodeStartSnapshot,
  encodeCatchSnapshot,
  isTournamentDate,
  encodePlayoffSnapshot,
  periodStatusLabel,
  playoffMatchId,
  playoffStageCode,
  totalFish,
  type PeriodMark,
  type PlayerQrExportResult,
  type PlayerQrImportResult,
  type QrCatchCell,
  type QrPlayoffCell,
  type StartSeat,
} from "./qrSync.ts";

const PERIODS_PER_ROUND = QUALIFYING_PERIOD_COUNT;

export interface RegisteredParticipant {
  slotId: string;
  bibNumber: number;
  displayName: string;
  groupId: GroupId;
  /** Не пришёл: слот и номер жеребьёвки сохраняются. */
  ghost: boolean;
}

export interface PendingCatch {
  slotId: string;
  delta: FishDelta;
}

interface SectorView {
  sectorLabel: string;
  sideLabel: "СЛЕВА" | "СПРАВА";
  athleteSlotId: string;
  opponentSlotId: string;
  athleteName: string;
  opponentName: string;
  /** «Вы в секторе 1 СЛЕВА, ваш соперник Спортсмен №2» */
  briefing: string;
  /** «Спортсмен №5 Иванов», когда в секторе нет живого соперника. */
  neighborLabel: string;
}

interface MatchStore extends SectorView {
  tournamentId: string;
  round: RoundIndex;
  period: PeriodIndex;
  /** Сирена орга: ожидание, ловля или период закрыт. Часы телефона сюда не входят. */
  periodPhase: PeriodPhase;
  /** Организатор нажал «Запустить период». До этого текущий период — всегда 1. */
  officiallyStarted: boolean;
  athleteFish: number;
  opponentFish: number;
  /** Доп. 5 минут выбранной кубковой пары. */
  athleteExtraFish: number;
  opponentExtraFish: number;
  /** Золотая рыба выбранной кубковой пары. */
  athleteGoldenFish: number;
  opponentGoldenFish: number;
  /** Кто первым поймал золотую рыбу. Сторона A — спортсмен слева в паре. */
  goldenFirst: "a" | "b" | null;
  /** Организатор уже менял счёт открытой пары: сетка показывает черновик. */
  playoffDraftActive: boolean;
  pending: PendingCatch[];
  confirmed: boolean;
  saving: boolean;
  savedCount: number | null;
  error: string | null;
  leaderboard: LeaderboardEntry[];
  leaderboardReady: boolean;
  participants: RegisteredParticipant[];
  /** Номера, для которых на этом телефоне уже записано ФИО игрока. */
  playerNamedSlotIds: string[];
  /** Сетка всех периодов. Пустая, пока турнир не открыт. */
  grid: GridSlot[];
  sectorCount: number;
  /** Сколько периодов отбора в сетке. Пока 8, число приходит из открытия турнира. */
  periodsCount: number;
  tournamentOpened: boolean;
  /** Название, которое игрок видит после сканирования жеребьёвки. */
  tournamentName: string;
  /** День проведения, ISO `YYYY-MM-DD`. */
  tournamentDate: string;
  setupSaving: boolean;
  setupError: string | null;
  hydrated: boolean;
  /** Сетка кубка. Пустая, пока не записан FORM_PLAYOFF. */
  playoff: PlayoffProjection;
  /** Все живые слоты 8-го периода закрыты протоколом. */
  eighthPeriodClosed: boolean;
  selectedPlayoffMatchId: string;
  /** Окно ввода поимок выбранной кубковой пары. */
  playoffEntryOpen: boolean;
  playoffSaving: boolean;
  playoffError: string | null;
  adjustFish: (who: "athlete" | "opponent", delta: FishDelta) => void;
  /** Доп. 5 минут или золотая рыба в открытой кубковой паре. */
  adjustPlayoffLine: (phase: "extra" | "golden", who: "athlete" | "opponent", delta: FishDelta) => void;
  setGoldenFirst: (side: "a" | "b") => void;
  /** Период отбора 1–8. Пишет тот же сигнал, что и сирена орга. */
  setPeriod: (period: PeriodIndex) => void;
  /** Записать активный период и фазу сирены. Игрок без связи вызывает это вручную. */
  signalPeriod: (period: PeriodIndex, phase: PeriodPhase) => Promise<boolean>;
  signalSaving: boolean;
  /**
   * Телефон игрока принимает стартовый QR или короткий сигнал периода.
   * Стартовый код пишет сетку в IndexedDB и открывает ввод поимок.
   */
  acceptOrganizerCode: (payload: string) => Promise<
    { ok: true; fresh: boolean; label: string } | { ok: false; error: string }
  >;
  /**
   * Телефон финалиста принимает стартовый QR кубка.
   * Пишет топ-8 и пары 1/4 в IndexedDB и открывает кубковые матчи.
   */
  acceptPlayoffGrid: (payload: string) => Promise<
    { ok: true; fresh: boolean; label: string } | { ok: false; error: string }
  >;
  /**
   * Подтверждение периода игрока или дуэли.
   * `asOrganizer` — ввод поимок в сетке кубка: ФИО на этом телефоне не требуется.
   */
  confirmPeriod: (asOrganizer?: boolean) => Promise<void>;
  loadLeaderboard: () => Promise<LeaderboardEntry[]>;
  hydrate: () => Promise<void>;
  registerParticipant: (displayName: string) => Promise<boolean>;
  /** Пачка «Спортсмен №1…N» на пустой стартовый лист. */
  seedNumberedStart: (count: number) => Promise<boolean>;
  /**
   * Одна пачка из JSON онлайн-регистрации.
   * Форма файла: { "participants": [{ "bibNumber": 1, "displayName": "Иванов", "groupId": "A" }] }
   */
  importRegistrationBatch: (value: unknown) => Promise<boolean>;
  /**
   * ФИО с `GET /api/participants` в порядке заявок.
   * Новые имена дописываются в лист и получают следующие номера: 1, 2, 3 без пропусков.
   */
  importOnlineRoster: (names: readonly string[]) => Promise<OnlineRosterImportResult>;
  replaceParticipant: (slotId: string, displayName: string) => Promise<boolean>;
  /**
   * До открытия турнира фантома не создаёт: строка снимается целиком, номера смыкаются.
   * После открытия пустой слот с этого экрана не ставится.
   */
  setParticipantGhost: (slotId: string) => Promise<boolean>;
  removeParticipant: (slotId: string) => Promise<boolean>;
  clearParticipants: () => Promise<boolean>;
  /** Стирает журнал, участников и сетку. Экран возвращается к новой жеребьёвке. */
  resetTournament: () => Promise<boolean>;
  /**
   * Строит матрицу переходов на все периоды, пишет матчи в IndexedDB
   * и переводит экран ввода в боевой режим.
   */
  startTournament: (meta?: { name: string; date: string }) => Promise<boolean>;
  openTournament: () => Promise<boolean>;
  /** Номер на этом телефоне. Кубковый QR кодирует его поимки. */
  selfSlotId: string;
  /** Номер рыбака на экране ввода: сектор, сторона и соперник из сетки текущего периода. */
  selectAthlete: (slotId: string) => void;
  /** Несинхронизированные поимки выбранного номера, сжатые в строку QR. */
  exportAthleteResults: () => Promise<PlayerQrExportResult>;
  /** Вписывает строку QR в журнал и помечает эти поимки синхронизированными. */
  importAthleteResults: (payload: string) => Promise<PlayerQrImportResult>;
  /** Все 8 периодов отбора этого номера подтверждены в журнале телефона. */
  qualifyingHandoffReady: boolean;
  /** Сколько периодов 1–8 этот номер уже сохранил на телефоне. */
  qualifyingSavedCount: number;
  /** Есть несинхронизированный кубковый матч выбранного номера. */
  cupHandoffReady: boolean;
  refreshHandoff: () => Promise<void>;
  /**
   * Ручная правка поимок обеих сторон дуэли.
   * Баллы в журнал не пишутся: после записи их заново считает калькулятор.
   */
  correctPeriodFish: (slotId: string, period: PeriodIndex, ownFish: number, opponentFish: number) => Promise<string | null>;
  /** Топ-8 после 8-го периода: пары 1–8, 2–7, 3–6, 4–5. Пишет FORM_PLAYOFF. */
  formPlayoff: () => Promise<boolean>;
  /** Финал и матч за 3-е место уже есть: снимок уходит в PostgreSQL. */
  archiveTournament: () => Promise<ArchivePostResult>;
  selectPlayoffMatch: (matchId: string) => void;
  /** Открывает окно поимок четвертьфинала, полуфинала или финала. */
  openPlayoffEntry: (matchId: string) => void;
  closePlayoffEntry: () => void;
  /** Пакеты улова, которые сервер ещё не принял. */
  outboxQueue: OutboxItem[];
  /** Открытые расхождения дуэлей. Ячейка таблицы орга красится по этому списку. */
  duelConflicts: DuelConflictRecord[];
  /** Тихий итог последней отправки периода: сеть или только телефон. */
  syncNote: string | null;
  /** По очереди отправляет всё, что зависло, пока есть сеть. */
  flushOutbox: () => Promise<{ sent: number }>;
  /** Вносит онлайн-результаты в пустые ячейки и помечает расхождения. */
  applyOnlineMatches: (matches: readonly SyncMatch[]) => Promise<boolean>;
}

const emptySector: SectorView = {
  sectorLabel: "—",
  sideLabel: "СЛЕВА",
  athleteSlotId: "",
  opponentSlotId: "",
  athleteName: "Вы",
  opponentName: "Соперник",
  briefing: "",
  neighborLabel: "",
};

const TOURNAMENT_ID_KEY = "fishing-portal.tournamentId";

function readStoredTournamentId(): string | null {
  try {
    const stored = localStorage.getItem(TOURNAMENT_ID_KEY)?.trim() ?? "";
    if (stored.length > 0 && stored.length <= 80) return stored;
  } catch {
    /* приватный режим или серверный импорт модуля */
  }
  return null;
}

function rememberTournamentId(tournamentId: string): void {
  try {
    localStorage.setItem(TOURNAMENT_ID_KEY, tournamentId);
  } catch {
    /* приватный режим: идентификатор живёт до перезагрузки */
  }
}

const PLAYER_DEVICE_ID = "player" as const;

function rememberAthleteSlot(slotId: string): void {
  const athleteSlotId = slotId.trim();
  void db.deviceState.put({ id: PLAYER_DEVICE_ID, athleteSlotId }).catch(() => {
    /* номер можно выбрать снова, журнал поимок уже в IndexedDB */
  });
}

function forgetAthleteSlot(): void {
  void db.deviceState.delete(PLAYER_DEVICE_ID).catch(() => {
    /* пустой телефон просто откроет выбор номера */
  });
}

function initialTournamentId(): string {
  return readStoredTournamentId() ?? "local-session";
}

/** Журнал на телефоне важнее пустого ключа: после перезагрузки остаётся то же соревнование. */
async function resolveTournamentId(preferred: string): Promise<string> {
  const preferredCount = await db.events.where("tournamentId").equals(preferred).count();
  if (preferredCount > 0) return preferred;
  const latest = await db.events.orderBy("timestamp").reverse().first();
  const recovered = latest?.tournamentId;
  if (recovered && recovered !== preferred) {
    rememberTournamentId(recovered);
    return recovered;
  }
  return preferred;
}

/**
 * Раньше все соревнования сидели на одном ключе `local-session`.
 * Живой журнал переезжает на свой id, чтобы новая архивация не затирала уже сданный отчёт.
 */
let placeholderMigration: Promise<string> | null = null;
let hydration: Promise<void> | null = null;

function separatePlaceholderTournament(): Promise<string> {
  if (!placeholderMigration) placeholderMigration = movePlaceholderTournament();
  return placeholderMigration;
}

async function movePlaceholderTournament(): Promise<string> {
  const rows = await db.events.where("tournamentId").equals("local-session").toArray();
  const nextId = crypto.randomUUID();
  if (rows.length > 0) {
    await db.transaction("rw", db.events, async () => {
      await Promise.all(
        rows.map((row) =>
          db.events.update(row.id, {
            tournamentId: nextId,
            event: { ...row.event, tournamentId: nextId },
          }),
        ),
      );
    });
  }
  rememberTournamentId(nextId);
  return nextId;
}

export const useMatchStore = create<MatchStore>((set, get) => ({
  tournamentId: initialTournamentId(),
  ...emptySector,
  playerNamedSlotIds: [],
  round: 1,
  period: 1,
  periodPhase: "waiting",
  officiallyStarted: false,
  athleteFish: 0,
  opponentFish: 0,
  athleteExtraFish: 0,
  opponentExtraFish: 0,
  athleteGoldenFish: 0,
  opponentGoldenFish: 0,
  goldenFirst: null,
  playoffDraftActive: false,
  pending: [],
  confirmed: false,
  saving: false,
  savedCount: null,
  error: null,
  leaderboard: [],
  leaderboardReady: false,
  participants: [],
  grid: [],
  sectorCount: 0,
  periodsCount: PERIODS_PER_ROUND,
  tournamentOpened: false,
  tournamentName: "",
  tournamentDate: "",
  setupSaving: false,
  setupError: null,
  hydrated: false,
  playoff: emptyPlayoffProjection,
  eighthPeriodClosed: false,
  selectedPlayoffMatchId: "",
  playoffEntryOpen: false,
  playoffSaving: false,
  playoffError: null,
  selfSlotId: "",
  qualifyingHandoffReady: false,
  qualifyingSavedCount: 0,
  cupHandoffReady: false,
  signalSaving: false,
  outboxQueue: [],
  duelConflicts: [],
  syncNote: null,

  adjustFish(who, delta) {
    const state = get();
    if (!state.tournamentOpened || state.saving) return;
    if (state.playoff.formed) {
      if (!state.selectedPlayoffMatchId) return;
      const countKey = who === "athlete" ? "athleteFish" : "opponentFish";
      const nextCount = state[countKey] + delta;
      if (nextCount < 0) return;
      set({
        [countKey]: nextCount,
        playoffDraftActive: true,
        pending: [],
        confirmed: false,
        savedCount: null,
        error: null,
      });
      return;
    }
    if (state.confirmed) return;

    const countKey = who === "athlete" ? "athleteFish" : "opponentFish";
    const slotId = who === "athlete" ? state.athleteSlotId : state.opponentSlotId;
    if (!slotId) return;
    const nextCount = state[countKey] + delta;
    if (nextCount < 0) return;

    set({
      [countKey]: nextCount,
      pending: [...state.pending, { slotId, delta }],
      savedCount: null,
      error: null,
    });
  },

  adjustPlayoffLine(phase, who, delta) {
    const state = get();
    if (!state.tournamentOpened || state.saving || !state.playoff.formed || !state.selectedPlayoffMatchId) return;
    const countKey =
      phase === "extra"
        ? who === "athlete"
          ? "athleteExtraFish"
          : "opponentExtraFish"
        : who === "athlete"
          ? "athleteGoldenFish"
          : "opponentGoldenFish";
    const nextCount = state[countKey] + delta;
    if (nextCount < 0) return;
    set({
      [countKey]: nextCount,
      goldenFirst: phase === "golden" ? null : state.goldenFirst,
      playoffDraftActive: true,
      pending: [],
      confirmed: false,
      savedCount: null,
      error: null,
    });
  },

  setGoldenFirst(side) {
    const state = get();
    if (!state.playoff.formed || state.saving || !state.selectedPlayoffMatchId) return;
    set({
      goldenFirst: side,
      playoffDraftActive: true,
      pending: [],
      confirmed: false,
      savedCount: null,
      error: null,
    });
  },

  setPeriod(period) {
    const state = get();
    if (!isQualifyingPeriod(period) || period === state.period) return;
    void state.signalPeriod(period, state.periodPhase);
  },

  async signalPeriod(period, phase) {
    const state = get();
    if (!state.tournamentOpened || state.saving || state.signalSaving || state.playoff.formed) return false;
    if (!isQualifyingPeriod(period)) return false;
    if (period === state.period && phase === state.periodPhase) return true;

    const event: TournamentEvent = {
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PERIOD_SIGNAL",
      timestamp: Date.now(),
      payload: { period, phase },
    };
    const periodChanged = period !== state.period;
    const resumeFishing = !periodChanged && phase === "fishing" && state.periodPhase !== "fishing";
    const selected = state.athleteSlotId;
    set({ signalSaving: true, error: null });
    try {
      await db.events.add(toRecord(event));
      set({
        signalSaving: false,
        period,
        periodPhase: phase,
        officiallyStarted: state.officiallyStarted || phase !== "waiting",
        ...(periodChanged
          ? {
              ...emptySector,
              athleteFish: 0,
              opponentFish: 0,
              pending: [],
              confirmed: false,
              savedCount: null,
            }
          : resumeFishing
            ? { confirmed: false, pending: [] }
            : {}),
      });
      if (periodChanged && selected) get().selectAthlete(selected);
      return true;
    } catch (error) {
      set({
        signalSaving: false,
        error: error instanceof Error ? error.message : "Не удалось записать сигнал периода",
      });
      return false;
    }
  },

  async acceptOrganizerCode(payload) {
    const text = payload.trim();
    if (text.replace(/\s+/g, "").startsWith("FTPC1")) return importPlayoffGrid(get, set, text);
    if (text.startsWith("FTPP1")) {
      const decoded = decodePeriodSignal(text);
      if (!decoded.ok) return decoded;
      if (!get().tournamentOpened) {
        return { ok: false, error: "Сначала сканируйте стартовый QR с жеребьёвкой" };
      }
      const saved = await get().signalPeriod(decoded.mark.period, decoded.mark.phase);
      if (!saved) return { ok: false, error: get().error ?? "Не удалось записать период" };
      return { ok: true, fresh: false, label: periodStatusLabel(decoded.mark.period, decoded.mark.phase) };
    }
    if (text.startsWith("FTPS1")) return importStartDraw(get, set, text);
    if (text.startsWith("FTP1")) {
      return { ok: false, error: "Это код результатов игрока, а не жеребьёвка организатора" };
    }
    return { ok: false, error: "Это не код организатора" };
  },

  async acceptPlayoffGrid(payload) {
    const compact = payload.trim().replace(/\s+/g, "");
    if (!compact.startsWith("FTPC1")) return { ok: false, error: "Это не стартовый код плей-офф" };
    return importPlayoffGrid(get, set, payload.trim());
  },

  async confirmPeriod(asOrganizer) {
    const state = get();
    if (state.playoff.formed && asOrganizer) {
      await savePlayoffDuel(get, set);
      return;
    }
    const identityId = state.playoff.formed ? state.selfSlotId : state.athleteSlotId;
    if (!hasSavedRealName(state, identityId)) {
      set({ error: "Выберите номер и введите ФИО" });
      return;
    }
    if (state.playoff.formed) {
      await savePlayoffDuel(get, set);
      return;
    }
    if (!state.tournamentOpened || state.confirmed || state.saving || state.signalSaving || !state.athleteSlotId) return;

    set({ saving: true, error: null, syncNote: null });
    const timestamp = Date.now();
    const slotIds = [state.athleteSlotId, state.opponentSlotId].filter((slotId) => slotId.length > 0);
    const events: TournamentEvent[] = absoluteCatches(state, slotIds, timestamp);

    events.push({
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PERIOD_COMPLETED",
      timestamp: timestamp + events.length,
      payload: {
        round: state.round,
        period: state.period,
        protocols: [
          {
            slotIdA: state.athleteSlotId,
            slotIdB: state.opponentSlotId || null,
            signed: true,
          },
        ],
      },
    });

    try {
      await replacePeriodCatches(state.tournamentId, state.round, state.period, slotIds, events);
      let syncNote = LOCAL_SAVE_NOTE;
      try {
        syncNote = await enqueuePeriodReport(state);
      } catch {
        syncNote = LOCAL_SAVE_NOTE;
      }
      set({
        saving: false,
        confirmed: true,
        pending: [],
        savedCount: events.length,
        syncNote,
      });
      await get().loadLeaderboard();
      await get().refreshHandoff();
      if (state.period < QUALIFYING_PERIOD_COUNT) {
        await get().signalPeriod((state.period + 1) as PeriodIndex, "waiting");
      }
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : "Не удалось записать период",
      });
    }
  },

  async loadLeaderboard() {
    const tournamentId = get().tournamentId;
    try {
      const rows = await db.events.where("tournamentId").equals(tournamentId).sortBy("timestamp");
      const stored = rows.map((row) => row.event);
      const latest = get();
      const events = [...stored, ...unconfirmedCatches(latest)];
      const leaderboard = tournamentCalculator.generateLeaderboard(events);
      set({
        leaderboard,
        leaderboardReady: true,
        error: null,
        ...cupPatch(stored, latest.participants, latest.grid),
      });
      return leaderboard;
    } catch (error) {
      set({
        leaderboardReady: true,
        error: error instanceof Error ? error.message : "Не удалось посчитать таблицу",
      });
      return [];
    }
  },

  async hydrate() {
    if (hydration) return hydration;
    hydration = readJournal(get, set).finally(() => {
      hydration = null;
    });
    return hydration;
  },

  async registerParticipant(displayName) {
    const name = displayName.trim();
    const state = get();
    if (!name || state.tournamentOpened || state.setupSaving) return false;

    const roster = denseStartList(state.participants);
    const bibNumber = roster.length + 1;
    const participant: RegisteredParticipant = {
      slotId: crypto.randomUUID(),
      bibNumber,
      displayName: name,
      groupId: "A",
      ghost: false,
    };
    const event: TournamentEvent = {
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PARTICIPANT_REGISTERED",
      timestamp: Date.now(),
      payload: {
        slotId: participant.slotId,
        bibNumber: participant.bibNumber,
        displayName: participant.displayName,
        groupId: participant.groupId,
      },
    };

    const previous = state.participants;
    const nextParticipants = [...roster, participant];
    set({
      participants: nextParticipants,
      sectorCount: requiredSectorCount(nextParticipants.length),
      setupSaving: true,
      setupError: null,
    });

    let rosterSaved = sameRoster(previous, roster);
    try {
      if (!rosterSaved) {
        await persistDenseRoster(state.tournamentId, roster);
        rosterSaved = true;
      }
      await db.events.add(toRecord(event));
      set({ setupSaving: false });
      return true;
    } catch (error) {
      const restored = rosterSaved ? roster : previous;
      set({
        setupSaving: false,
        participants: restored,
        sectorCount: requiredSectorCount(restored.length),
        setupError: error instanceof Error ? error.message : "Не удалось записать участника",
      });
      return false;
    }
  },

  async seedNumberedStart(count) {
    const state = get();
    if (state.tournamentOpened || state.setupSaving) return false;
    if (!Number.isInteger(count) || count < 2 || count > MAX_REGISTRATION_BATCH) {
      set({ setupError: `Укажите число рыбаков от 2 до ${MAX_REGISTRATION_BATCH}` });
      return false;
    }
    if (state.participants.length > 0) {
      set({ setupError: "Номера собираются на пустой стартовый лист" });
      return false;
    }
    return appendRegisteredParticipants(set, state, numberedRegistrationBatch(count).participants);
  },

  async importRegistrationBatch(value) {
    const state = get();
    if (state.tournamentOpened || state.setupSaving) return false;
    const parsed = parseRegistrationBatch(value);
    if (!parsed.ok) {
      set({ setupError: parsed.error });
      return false;
    }
    return appendRegisteredParticipants(set, state, parsed.batch.participants);
  },

  async importOnlineRoster(names) {
    const state = get();
    if (state.tournamentOpened) {
      return { ok: false, error: "Турнир уже открыт — лист больше не меняется" };
    }
    if (state.setupSaving) {
      return { ok: false, error: "Стартовый лист сейчас записывается" };
    }

    const roster = denseStartList(state.participants);
    const taken = new Set(roster.map((participant) => registrationKey(participant.displayName)));
    const fresh: string[] = [];
    let alreadyOnSheet = 0;
    for (const raw of names) {
      const displayName = registrationName(raw);
      if (displayName.length < 3) continue;
      const key = registrationKey(displayName);
      if (taken.has(key)) {
        alreadyOnSheet += 1;
        continue;
      }
      taken.add(key);
      fresh.push(displayName);
    }

    if (fresh.length === 0) {
      if (names.length === 0) return { ok: false, error: "На сервере пока нет заявок" };
      if (alreadyOnSheet > 0) return { ok: false, error: "Эти спортсмены уже есть в стартовом листе" };
      return { ok: false, error: "В онлайн-списке нет ФИО" };
    }

    const fromBib = roster.length + 1;
    const entries: RegistrationBatchEntry[] = fresh.map((displayName, index) => ({
      bibNumber: fromBib + index,
      displayName,
      groupId: "A",
    }));
    const saved = await appendRegisteredParticipants(set, get(), entries);
    if (!saved) return { ok: false, error: get().setupError ?? "Не удалось записать участников" };
    return {
      ok: true,
      added: fresh.length,
      alreadyOnSheet,
      fromBib,
      toBib: fromBib + fresh.length - 1,
    };
  },

  async replaceParticipant(slotId, displayName) {
    const name = displayName.trim().replace(/\s+/g, " ");
    const state = get();
    if (!name || state.setupSaving) return false;

    const current = state.participants.find((participant) => participant.slotId === slotId);
    if (!current) return false;
    if (state.tournamentOpened && current.ghost) return false;
    if (current.displayName === name && state.playerNamedSlotIds.includes(slotId)) return true;

    const event: TournamentEvent = {
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PARTICIPANT_REPLACED",
      timestamp: Date.now(),
      payload: {
        slotId,
        displayName: name,
      },
    };
    const nextParticipant = {
      ...current,
      bibNumber: current.bibNumber,
      displayName: name,
      ghost: state.tournamentOpened ? current.ghost : false,
    };
    const nextLeaderboard = state.leaderboard.map((entry) =>
      entry.slotId === slotId ? { ...entry, bibNumber: entry.bibNumber, displayName: name } : entry,
    );
    const saved = await commitParticipantUpdate(set, state.participants, slotId, nextParticipant, event, {
      optimistic: {
        ...renamedLabels(state, current.bibNumber, slotId, name),
        leaderboard: nextLeaderboard,
      },
      rollback: {
        athleteName: state.athleteName,
        opponentName: state.opponentName,
        briefing: state.briefing,
        neighborLabel: state.neighborLabel,
        leaderboard: state.leaderboard,
      },
    });
    if (!saved) return false;
    const named = get().playerNamedSlotIds;
    if (!named.includes(slotId)) set({ playerNamedSlotIds: [...named, slotId] });
    if (get().tournamentOpened) {
      const selected = get().athleteSlotId;
      if (selected) get().selectAthlete(selected);
      await get().loadLeaderboard();
    }
    return true;
  },

  async setParticipantGhost(slotId) {
    const state = get();
    if (state.setupSaving) return false;
    // До сетки переходов пустой слот держит номер и оставляет дыру. Строка снимается целиком.
    if (!state.tournamentOpened) return get().removeParticipant(slotId);
    return false;
  },

  async removeParticipant(slotId) {
    const state = get();
    if (state.tournamentOpened || state.setupSaving) return false;
    if (!state.participants.some((participant) => participant.slotId === slotId)) return false;
    return dropParticipants(set, state, [slotId]);
  },

  async resetTournament() {
    if (get().setupSaving) return false;
    set({ setupSaving: true, setupError: null });
    try {
      await db.events.clear();
      await db.outboxQueue.clear();
      await db.duelConflicts.clear();
      await db.deviceState.clear();
      const tournamentId = crypto.randomUUID();
      rememberTournamentId(tournamentId);
      set({
        tournamentId,
        ...emptySector,
        round: 1,
        period: 1,
        periodPhase: "waiting",
        officiallyStarted: false,
        athleteFish: 0,
        opponentFish: 0,
        pending: [],
        confirmed: false,
        saving: false,
        signalSaving: false,
        savedCount: null,
        error: null,
        leaderboard: [],
        leaderboardReady: true,
        participants: [],
        grid: [],
        sectorCount: 0,
        periodsCount: PERIODS_PER_ROUND,
        tournamentOpened: false,
        tournamentName: "",
        tournamentDate: "",
        setupSaving: false,
        setupError: null,
        hydrated: true,
        playoff: emptyPlayoffProjection,
        eighthPeriodClosed: false,
        selectedPlayoffMatchId: "",
        playoffEntryOpen: false,
        playoffSaving: false,
        playoffError: null,
        selfSlotId: "",
        qualifyingHandoffReady: false,
        qualifyingSavedCount: 0,
        cupHandoffReady: false,
        playerNamedSlotIds: [],
        outboxQueue: [],
        duelConflicts: [],
        syncNote: null,
      });
      return true;
    } catch (error) {
      set({
        setupSaving: false,
        setupError: error instanceof Error ? error.message : "Не удалось сбросить турнир",
      });
      return false;
    }
  },

  async clearParticipants() {
    const state = get();
    if (state.tournamentOpened || state.setupSaving) return false;
    if (state.participants.length === 0) return false;
    return dropParticipants(
      set,
      state,
      state.participants.map((participant) => participant.slotId),
    );
  },

  async startTournament(meta) {
    const state = get();
    if (state.tournamentOpened || state.setupSaving) return state.tournamentOpened;
    if (state.participants.length < 2) {
      set({ setupError: "Добавьте хотя бы двух участников" });
      return false;
    }
    const tournamentName = (meta?.name ?? state.tournamentName).trim().replace(/\s+/g, " ");
    const tournamentDate = (meta?.date ?? state.tournamentDate).trim();
    if (!tournamentName) {
      set({ setupError: "Укажите название турнира" });
      return false;
    }
    if (!isTournamentDate(tournamentDate)) {
      set({ setupError: "Укажите дату проведения" });
      return false;
    }

    const ordered = [...state.participants].sort(byBib);
    const sectorCount = requiredSectorCount(ordered.length);
    const grid = gridOf(ordered, PERIODS_PER_ROUND);
    const matrix = matrixFromGrid(grid, ordered);
    const timestamp = Date.now();
    const comparisons = loneComparisonEvents(state.tournamentId, ordered, grid, timestamp + 2);
    const opened: TournamentEvent = {
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "TOURNAMENT_OPENED",
      timestamp,
      payload: {
        rulesetId: "pal-trout-2026",
        name: tournamentName,
        date: tournamentDate,
        periodsPerRound: PERIODS_PER_ROUND,
        rounds: 2,
        sectorCount,
      },
    };
    const draw: TournamentEvent = {
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "DRAW_SEEDED",
      timestamp: timestamp + 1,
      payload: {
        slots: ordered.map((participant) => ({
          slotId: participant.slotId,
          bibNumber: participant.bibNumber,
          groupId: participant.groupId,
          displayName: participant.displayName,
          ghost: participant.ghost,
        })),
        matrix,
      },
    };

    set({ setupSaving: true, setupError: null });
    try {
      const existing = await db.events.where("tournamentId").equals(state.tournamentId).toArray();
      if (existing.some((row) => row.event.type === "TOURNAMENT_OPENED")) {
        const stored = existing.map((row) => row.event);
        const snapshot = readSetup(stored);
        const openedGrid = gridOf(snapshot.participants, snapshot.periodsPerRound);
        const signal = publishedPeriod(stored);
        set({
          setupSaving: false,
          tournamentOpened: true,
          participants: snapshot.participants,
          sectorCount: snapshot.sectorCount,
          periodsCount: snapshot.periodsPerRound,
          tournamentName: snapshot.tournamentName,
          tournamentDate: snapshot.tournamentDate,
          grid: openedGrid,
          period: signal.period,
          periodPhase: signal.phase,
          officiallyStarted: signal.officiallyStarted,
          playerNamedSlotIds: playerNamedFromEvents(stored),
          ...emptySector,
          ...cupPatch(stored, snapshot.participants, openedGrid),
        });
        return true;
      }

      await db.events.bulkAdd([toRecord(opened), toRecord(draw), ...comparisons.map(toRecord)]);
      set({
        setupSaving: false,
        tournamentOpened: true,
        tournamentName,
        tournamentDate,
        sectorCount,
        periodsCount: PERIODS_PER_ROUND,
        grid,
        round: 1,
        period: 1,
        periodPhase: "waiting",
        officiallyStarted: false,
        confirmed: false,
        athleteFish: 0,
        opponentFish: 0,
        pending: [],
        savedCount: null,
        error: null,
        playoff: emptyPlayoffProjection,
        eighthPeriodClosed: false,
        selectedPlayoffMatchId: "",
        playoffEntryOpen: false,
        playoffError: null,
        ...emptySector,
      });
      await get().loadLeaderboard();
      return true;
    } catch (error) {
      set({
        setupSaving: false,
        setupError: error instanceof Error ? error.message : "Не удалось открыть турнир",
      });
      return false;
    }
  },

  async openTournament() {
    return get().startTournament();
  },

  async formPlayoff() {
    const state = get();
    if (state.playoffSaving) return false;
    if (state.playoff.formed) return true;
    if (!state.tournamentOpened) {
      set({ playoffError: "Сначала откройте турнир" });
      return false;
    }
    if (!state.eighthPeriodClosed) {
      set({ playoffError: "Сначала закройте 8-й период" });
      return false;
    }

    set({ playoffSaving: true, playoffError: null });
    try {
      const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
      const stored = rows.map((row) => row.event);
      if (stored.some((event) => event.type === "FORM_PLAYOFF")) {
        const playoff = projectPlayoff(stored);
        set({ playoffSaving: false, playoff, eighthPeriodClosed: true });
        const first = playoff.quarterfinals[0];
        if (first) get().selectPlayoffMatch(first.matchId);
        return true;
      }

      const fishing = new Set(
        state.participants.filter((participant) => !participant.ghost).map((participant) => participant.slotId),
      );
      const ranked = tournamentCalculator.generateLeaderboard(stored).filter((entry) => fishing.has(entry.slotId));
      const seeds = seedsFromRanking(ranked);
      const quarterfinals = seeds ? buildQuarterfinals(seeds) : null;
      if (!seeds || !quarterfinals) {
        set({ playoffSaving: false, playoffError: "Для плей-офф нужны 8 спортсменов в таблице" });
        return false;
      }

      const event: TournamentEvent = {
        id: crypto.randomUUID(),
        tournamentId: state.tournamentId,
        type: "FORM_PLAYOFF",
        timestamp: Date.now(),
        payload: { seeds, quarterfinals },
      };
      await db.events.add(toRecord(event));
      const playoff = projectPlayoff([...stored, event]);
      set({ playoffSaving: false, playoff, playoffError: null });
      const first = playoff.quarterfinals[0];
      if (first) get().selectPlayoffMatch(first.matchId);
      await get().loadLeaderboard();
      return true;
    } catch (error) {
      set({
        playoffSaving: false,
        playoffError: error instanceof Error ? error.message : "Не удалось сформировать плей-офф",
      });
      return false;
    }
  },

  async archiveTournament() {
    const state = get();
    if (!state.tournamentOpened) return { ok: false, error: "Сначала откройте турнир" };
    try {
      const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
      const events = rows.map((row) => row.event);
      const qualifyingLeaderboard = tournamentCalculator.generateLeaderboard(events);
      const playoff = projectPlayoff(events);
      const snapshot = buildTournamentArchive({
        tournament: {
          id: state.tournamentId,
          name: state.tournamentName,
          date: state.tournamentDate,
          sectorCount: state.sectorCount,
          periodsCount: state.periodsCount,
        },
        participants: state.participants.map((participant) => ({
          slotId: participant.slotId,
          bibNumber: participant.bibNumber,
          displayName: participant.displayName,
          groupId: participant.groupId,
          ghost: participant.ghost,
        })),
        qualifyingLeaderboard,
        playoff,
        events,
      });
      if (!snapshot) return { ok: false, error: "Сначала завершите финал и матч за 3-е место" };
      return await postTournamentArchive(snapshot, state.tournamentId);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Не удалось собрать архив турнира",
      };
    }
  },

  selectPlayoffMatch(matchId) {
    const state = get();
    if (!state.playoff.formed || state.saving) return;
    const match = playoffMatches(state.playoff).find((item) => item.matchId === matchId);
    if (!match?.slotIdA || !match.slotIdB) return;
    const scored = match.fishA !== null && match.fishB !== null && match.winnerSlotId !== null;
    set({
      ...viewFromPlayoff(state.participants, match),
      selectedPlayoffMatchId: matchId,
      athleteFish: scored ? match.fishA ?? 0 : 0,
      opponentFish: scored ? match.fishB ?? 0 : 0,
      athleteExtraFish: scored ? match.extraFishA ?? 0 : 0,
      opponentExtraFish: scored ? match.extraFishB ?? 0 : 0,
      athleteGoldenFish: scored ? match.goldenFishA ?? 0 : 0,
      opponentGoldenFish: scored ? match.goldenFishB ?? 0 : 0,
      goldenFirst: scored ? match.goldenFirst : null,
      playoffDraftActive: false,
      pending: [],
      confirmed: scored,
      savedCount: null,
      error: null,
    });
  },

  openPlayoffEntry(matchId) {
    const state = get();
    if (!state.playoff.formed || state.saving) return;
    get().selectPlayoffMatch(matchId);
    if (get().selectedPlayoffMatchId !== matchId) return;
    set({ playoffEntryOpen: true });
  },

  closePlayoffEntry() {
    if (get().saving) return;
    const matchId = get().selectedPlayoffMatchId;
    set({ playoffEntryOpen: false });
    if (matchId) get().selectPlayoffMatch(matchId);
  },

  selectAthlete(slotId) {
    const state = get();
    if (!state.tournamentOpened || state.saving) return;
    if (state.playoff.formed) {
      if (!slotId) {
        set({ selfSlotId: "" });
        forgetAthleteSlot();
        void get().refreshHandoff();
        return;
      }
      const playing = state.participants.find((item) => item.slotId === slotId);
      if (!playing || playing.ghost) return;
      set({ selfSlotId: slotId, error: null });
      rememberAthleteSlot(slotId);
      void get().refreshHandoff();
      return;
    }
    if (!slotId) {
      set({
        ...emptySector,
        selfSlotId: "",
        athleteFish: 0,
        opponentFish: 0,
        pending: [],
        confirmed: false,
        savedCount: null,
        error: null,
      });
      forgetAthleteSlot();
      void get().refreshHandoff();
      return;
    }

    const participant = state.participants.find((item) => item.slotId === slotId);
    if (!participant || participant.ghost) return;
    const slot = state.grid.find(
      (item) => item.slotId === slotId && item.round === state.round && item.period === state.period,
    );
    if (!slot) {
      set({ ...emptySector, error: "В этом периоде для номера нет сектора" });
      return;
    }

    const sameAthlete = state.athleteSlotId === slotId;
    const saved = sameAthlete ? null : journalPeriodScore(state.leaderboard, slotId, state.period);
    set({
      ...viewFromGrid(state.participants, state.grid, slot),
      selfSlotId: slotId,
      error: null,
      ...(saved
        ? {
            athleteFish: saved.athleteFish,
            opponentFish: saved.opponentFish,
            pending: [],
            confirmed: saved.confirmed,
            savedCount: null,
          }
        : {}),
    });
    rememberAthleteSlot(slotId);
    void get().refreshHandoff();
  },

  async exportAthleteResults() {
    const state = get();
    const slotId = state.playoff.formed ? state.selfSlotId : state.athleteSlotId;
    if (!state.tournamentOpened || !slotId) {
      return { ok: false, error: "Сначала выберите свой номер" };
    }
    const participant = state.participants.find((item) => item.slotId === slotId);
    if (!participant || participant.ghost) {
      return { ok: false, error: "Этот номер нельзя передать" };
    }

    try {
      const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
      if (state.playoff.formed) {
        const playoffCells = playoffSnapshot(state, rows, slotId);
        if (playoffCells.length === 0) return { ok: false, error: "Сначала сохраните кубковый матч" };
        const athleteName = state.playerNamedSlotIds.includes(participant.slotId) ? participant.displayName : null;
        return {
          ok: true,
          packet: {
            payload: encodePlayoffSnapshot(participant.bibNumber, playoffCells, null, athleteName),
            bibNumber: participant.bibNumber,
            displayName: participant.displayName,
            fish: totalFish(playoffCells),
            periods: playoffCells.length,
            cells: [],
            playoffCells,
          },
        };
      }

      const stored = rows.map((row) => row.event);
      const journal = qualifyingJournalStatus(stored, slotId);
      if (!journal.ready) {
        return { ok: false, error: `Сначала подтвердите все 8 периодов. Уже сохранено: ${journal.saved} из 8.` };
      }
      const entry = tournamentCalculator.generateLeaderboard(stored).find((item) => item.slotId === slotId);
      const cells: QrCatchCell[] = QUALIFYING_PERIODS.map((period) => ({
        round: 1,
        period,
        fish: entry?.periods.find((item) => item.period === period)?.fish ?? 0,
      }));
      const mark = currentPeriodMark(state);
      const athleteName = state.playerNamedSlotIds.includes(participant.slotId) ? participant.displayName : null;
      return {
        ok: true,
        packet: {
          payload: encodeCatchSnapshot(participant.bibNumber, cells, mark, athleteName),
          bibNumber: participant.bibNumber,
          displayName: participant.displayName,
          fish: totalFish(cells),
          periods: cells.length,
          cells,
          playoffCells: [],
          markLabel: periodStatusLabel(mark.period, mark.phase),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Не удалось собрать результаты",
      };
    }
  },

  async importAthleteResults(payload) {
    const trimmed = payload.trim();
    if (trimmed.replace(/\s+/g, "").startsWith("FTPC1")) {
      return { ok: false, error: "Это стартовый код сетки плей-офф. Его сканирует телефон финалиста." };
    }
    if (trimmed.startsWith("FTPS1") || trimmed.startsWith("FTPP1")) {
      return { ok: false, error: "Это код жеребьёвки или сигнала периода. Его сканирует телефон игрока." };
    }
    const decoded = decodeCatchSnapshot(payload);
    if (!decoded.ok) return decoded;
    const state = get();
    if (!state.tournamentOpened) return { ok: false, error: "Сначала откройте турнир" };
    const markLabel = decoded.mark ? periodStatusLabel(decoded.mark.period, decoded.mark.phase) : undefined;

    const participant = state.participants.find((item) => item.bibNumber === decoded.bibNumber);
    if (!participant) return { ok: false, error: `Игрок №${decoded.bibNumber} не найден в этом турнире` };
    if (participant.ghost) return { ok: false, error: `Игрок №${decoded.bibNumber} отмечен как не пришедший` };

    let athlete = participant;
    if (decoded.displayName) {
      await get().replaceParticipant(participant.slotId, decoded.displayName);
      athlete = get().participants.find((item) => item.slotId === participant.slotId) ?? participant;
    }

    if (decoded.mode === "playoff") {
      return importPlayoffSnapshot(get, set, athlete, decoded.cells, markLabel);
    }

    let disputes = 0;

    try {
      for (const cell of decoded.cells) {
        if (cell.round !== 1 || !isQualifyingPeriod(cell.period)) continue;
        const seat = periodSeat(get().grid, get().participants, participant.slotId, cell.period);
        const opponent = seat?.opponentSlotId
          ? get().participants.find((item) => item.slotId === seat.opponentSlotId)
          : undefined;
        const result = await ingestMatch(get, {
          period: cell.period,
          status: "PENDING",
          reports: [
            {
              bibNumber: participant.bibNumber,
              opponentBib: opponent && !opponent.ghost ? opponent.bibNumber : null,
              ownFish: cell.fish,
              opponentFish: null,
            },
          ],
        });
        disputes += result.conflicts;
      }
      const duelConflicts = await db.duelConflicts.toArray();
      set({ duelConflicts });
      await get().loadLeaderboard();
      await get().refreshHandoff();
      return {
        ok: true,
        packet: {
          bibNumber: athlete.bibNumber,
          displayName: athlete.displayName,
          fish: totalFish(decoded.cells),
          periods: decoded.cells.length,
          mark: markLabel,
          disputes,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Не удалось записать результаты",
      };
    }
  },

  async refreshHandoff() {
    const state = get();
    const playoffFormed = state.playoff.formed;
    const slotId = playoffFormed ? state.selfSlotId : state.athleteSlotId;
    if (!state.tournamentOpened || !slotId) {
      set({ qualifyingHandoffReady: false, qualifyingSavedCount: 0, cupHandoffReady: false });
      return;
    }

    try {
      const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
      const current = get();
      const currentSlot = current.playoff.formed ? current.selfSlotId : current.athleteSlotId;
      if (currentSlot !== slotId || current.playoff.formed !== playoffFormed) return;

      if (current.playoff.formed) {
        set({
          cupHandoffReady: playoffSnapshot(current, rows, slotId).length > 0,
          qualifyingHandoffReady: false,
        });
        return;
      }

      const journal = qualifyingJournalStatus(
        rows.map((row) => row.event),
        slotId,
      );
      set({
        qualifyingHandoffReady: journal.ready,
        qualifyingSavedCount: journal.saved,
        cupHandoffReady: false,
      });
    } catch {
      set({ qualifyingHandoffReady: false, qualifyingSavedCount: 0, cupHandoffReady: false });
    }
  },

  async correctPeriodFish(slotId, period, ownFish, opponentFish) {
    const state = get();
    if (!state.tournamentOpened || state.saving || state.setupSaving) return "Сейчас журнал занят";
    if (!isQualifyingPeriod(period)) return "Этот период нельзя править";
    const participant = state.participants.find((item) => item.slotId === slotId);
    if (!participant) return "Игрок не найден";
    if (participant.ghost) return "Пустой слот нельзя править";

    const own = clampFish(ownFish);
    const opp = clampFish(opponentFish);
    if (own === null || opp === null) return "Укажите число поимок";

    const seat = periodSeat(state.grid, state.participants, slotId, period);
    const opponentSlotId = seat?.opponentSlotId ?? null;
    if (opponentSlotId) {
      const opponent = state.participants.find((item) => item.slotId === opponentSlotId);
      if (!opponent || opponent.ghost) return "Соперник этого периода не найден";
    }

    const counts = new Map<string, number>([[slotId, own]]);
    if (opponentSlotId) counts.set(opponentSlotId, opp);
    const paired = opponentSlotId !== null && seat?.bergerOpponentSlotId === opponentSlotId;
    const timestamp = Date.now();
    const catches = catchEventsForCounts(state.tournamentId, period, counts, timestamp);
    const closed: TournamentEvent = {
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PERIOD_COMPLETED",
      timestamp: timestamp + catches.length,
      payload: {
        round: 1,
        period,
        protocols: [
          {
            slotIdA: slotId,
            slotIdB: paired ? opponentSlotId : null,
            signed: true,
          },
        ],
      },
    };

    try {
      await replacePeriodCatches(state.tournamentId, 1, period, [...counts.keys()], [...catches, closed]);
      const next = get();
      if (
        !next.playoff.formed &&
        next.period === period &&
        (next.athleteSlotId === slotId || (opponentSlotId !== null && next.athleteSlotId === opponentSlotId))
      ) {
        set({
          athleteFish:
            next.athleteSlotId === slotId ? own : opponentSlotId !== null && next.athleteSlotId === opponentSlotId ? opp : next.athleteFish,
          opponentFish:
            next.opponentSlotId === slotId
              ? own
              : opponentSlotId !== null && next.opponentSlotId === opponentSlotId
                ? opp
                : next.opponentFish,
          pending: [],
          confirmed: true,
          error: null,
        });
      }
      await resolveSlots(
        [slotId, opponentSlotId].filter((id): id is string => id !== null && id.length > 0),
        period,
      );
      await get().loadLeaderboard();
      await get().refreshHandoff();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Не удалось записать поимки";
    }
  },

  async flushOutbox() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return { sent: 0 };
    try {
      const items = await db.outboxQueue.orderBy("createdAt").toArray();
      let sent = 0;
      for (const item of items) {
        const ok = await postMatchReport({
          bibNumber: item.bibNumber,
          opponentBib: item.opponentBib,
          period: item.period,
          ownFish: item.ownFish,
          opponentFish: item.opponentFish,
        });
        if (!ok) break;
        await db.outboxQueue.delete(item.id);
        sent += 1;
      }
      set({ outboxQueue: await db.outboxQueue.orderBy("createdAt").toArray() });
      return { sent };
    } catch {
      return { sent: 0 };
    }
  },

  async applyOnlineMatches(matches) {
    return enqueueOnlineApply(async () => {
      if (!get().tournamentOpened || matches.length === 0) return true;
      try {
        let filled = 0;
        for (const match of matches) {
          const result = await ingestMatch(get, {
            period: match.period,
            status: match.status,
            reports: match.reports.map((report) => ({
              bibNumber: report.bibNumber,
              opponentBib: report.opponentBib,
              ownFish: report.ownFish,
              opponentFish: report.opponentFish,
            })),
          });
          filled += result.filled;
        }
        set({ duelConflicts: await db.duelConflicts.toArray() });
        if (filled > 0) {
          await get().loadLeaderboard();
          await get().refreshHandoff();
        }
        return true;
      } catch {
        // Сеть или журнал заняты. Следующий опрос повторит те же пакеты.
        return false;
      }
    });
  },
}));

/** Ручное обновление и фоновый опрос не пишут один и тот же период одновременно. */
let onlineApplyChain: Promise<unknown> = Promise.resolve();

function enqueueOnlineApply<T>(job: () => Promise<T>): Promise<T> {
  const run = onlineApplyChain.then(job, job);
  onlineApplyChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface SetupSnapshot {
  participants: RegisteredParticipant[];
  tournamentOpened: boolean;
  tournamentName: string;
  tournamentDate: string;
  sectorCount: number;
  periodsPerRound: number;
  matrix: readonly MatrixDuel[];
}

function readSetup(events: readonly TournamentEvent[]): SetupSnapshot {
  const participants: RegisteredParticipant[] = [];
  let tournamentOpened = false;
  let tournamentName = "";
  let tournamentDate = "";
  let sectorCount = 0;
  let periodsPerRound = PERIODS_PER_ROUND;
  let matrix: readonly MatrixDuel[] = [];

  for (const event of events) {
    if (event.type === "PARTICIPANT_REGISTERED") {
      participants.push({
        slotId: event.payload.slotId,
        bibNumber: event.payload.bibNumber,
        displayName: event.payload.displayName,
        groupId: event.payload.groupId,
        ghost: false,
      });
    } else if (event.type === "PARTICIPANT_REPLACED") {
      const participant = participants.find((item) => item.slotId === event.payload.slotId);
      if (participant) {
        participant.displayName = event.payload.displayName;
        participant.ghost = false;
      }
    } else if (event.type === "PARTICIPANT_SET_GHOST") {
      const participant = participants.find((item) => item.slotId === event.payload.slotId);
      if (participant) {
        participant.displayName = event.payload.displayName;
        participant.ghost = true;
      }
    } else if (event.type === "PARTICIPANT_REMOVED") {
      const index = participants.findIndex((item) => item.slotId === event.payload.slotId);
      if (index >= 0) participants.splice(index, 1);
    } else if (event.type === "TOURNAMENT_OPENED") {
      tournamentOpened = true;
      tournamentName = event.payload.name;
      tournamentDate = event.payload.date ?? "";
      sectorCount = event.payload.sectorCount;
      periodsPerRound = event.payload.periodsPerRound;
    } else if (event.type === "DRAW_SEEDED" && tournamentOpened) {
      matrix = event.payload.matrix;
    }
  }

  participants.sort((left, right) => left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId));
  return { participants, tournamentOpened, tournamentName, tournamentDate, sectorCount, periodsPerRound, matrix };
}

const MAX_REGISTRATION_BATCH = 200;

/** Одна строка пачки. Так выглядит участник в JSON онлайн-регистрации. */
export interface RegistrationBatchEntry {
  displayName: string;
  bibNumber?: number;
  groupId?: GroupId;
}

/** Файл, скачанный до выезда. На берегу его принимает importRegistrationBatch. */
export interface RegistrationBatch {
  participants: readonly RegistrationBatchEntry[];
}

export type RegistrationBatchResult = { ok: true; batch: RegistrationBatch } | { ok: false; error: string };

/** Результат кнопки «Импортировать список из онлайна». Номера — место в стартовом листе. */
export type OnlineRosterImportResult =
  | { ok: true; added: number; alreadyOnSheet: number; fromBib: number; toBib: number }
  | { ok: false; error: string };

export function numberedAthleteName(bibNumber: number): string {
  return `Спортсмен №${bibNumber}`;
}

export function numberedRegistrationBatch(count: number): RegistrationBatch {
  return {
    participants: Array.from({ length: count }, (_, index) => ({
      bibNumber: index + 1,
      displayName: numberedAthleteName(index + 1),
      groupId: "A" as const,
    })),
  };
}

export function parseRegistrationBatch(value: unknown): RegistrationBatchResult {
  if (!value || typeof value !== "object" || !("participants" in value) || !Array.isArray(value.participants)) {
    return { ok: false, error: "Файл регистрации должен содержать список participants" };
  }
  if (value.participants.length === 0) return { ok: false, error: "В пачке нет участников" };
  if (value.participants.length > MAX_REGISTRATION_BATCH) {
    return { ok: false, error: `В файле не больше ${MAX_REGISTRATION_BATCH} участников` };
  }

  const participants: RegistrationBatchEntry[] = [];
  for (const item of value.participants) {
    if (!item || typeof item !== "object") return { ok: false, error: "Участник в файле записан неверно" };
    const record = item as { displayName?: unknown; bibNumber?: unknown; groupId?: unknown };
    if (typeof record.displayName !== "string") return { ok: false, error: "У участника нет имени" };
    const entry: RegistrationBatchEntry = { displayName: record.displayName };
    if (record.bibNumber !== undefined) {
      if (typeof record.bibNumber !== "number") {
        return { ok: false, error: "Номер жеребьёвки должен быть целым числом от 1" };
      }
      entry.bibNumber = record.bibNumber;
    }
    if (record.groupId !== undefined) {
      if (record.groupId !== "A" && record.groupId !== "B") return { ok: false, error: "Группа должна быть A или B" };
      entry.groupId = record.groupId;
    }
    participants.push(entry);
  }
  return { ok: true, batch: { participants } };
}

/** PAL Trout: одна пара на сектор, нечётный участник занимает сектор один. */
export function requiredSectorCount(participantCount: number): number {
  if (participantCount <= 0) return 0;
  return Math.ceil(participantCount / 2);
}

/** Имя фантома. Номер жеребьёвки в имени — тот же слот, не новый участник. */
export function phantomName(bibNumber: number): string {
  return `ФАНТОМ ${bibNumber}`;
}

/**
 * Период 1 полной сетки. Нечётный номер слева, чётный справа.
 * Фантом место не освобождает: живой соперник остаётся один.
 */
export function planPeriodOne(participants: readonly RegisteredParticipant[], sectorCount: number): MatrixDuel[] {
  if (!Number.isInteger(sectorCount) || sectorCount < 1) return [];
  const ordered = [...participants].sort(byBib).slice(0, sectorCount * 2);
  return matrixFromGrid(gridOf(ordered, 1), ordered);
}

/** Сетка переходов на все периоды. Тот же расчёт, что пишется в журнал при открытии. */
export function scheduleGrid(
  participants: readonly RegisteredParticipant[],
  periodsCount: number,
): GridSlot[] {
  return gridOf(participants, periodsCount);
}

export type PeriodSector =
  | {
      sectorId: string;
      kind: "pair";
      leftSlotId: string;
      rightSlotId: string;
    }
  | {
      sectorId: string;
      kind: "lone";
      slotId: string;
      side: Side;
      /** Напротив живого места стоит фантом, а не пустой пропуск Бергера. */
      vacant: boolean;
      neighborSlotId: string | null;
    };

/** Секторы одного периода из уже посчитанной сетки. Сосед одиночки берётся из этого же периода. */
export function sectorsForPeriod(
  grid: readonly GridSlot[],
  participants: readonly RegisteredParticipant[],
  period: PeriodIndex,
): PeriodSector[] {
  const slots = grid.filter((slot) => slot.round === 1 && slot.period === period);
  const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
  const ghosts = new Set(
    participants.filter((participant) => participant.ghost).map((participant) => participant.slotId),
  );
  const sectors: PeriodSector[] = [];

  for (const seat of gridSeats(slots)) {
    const left = seat.left ? byId.get(seat.left.slotId) : undefined;
    const right = seat.right ? byId.get(seat.right.slotId) : undefined;
    const leftFishing = isFishing(left ?? null);
    const rightFishing = isFishing(right ?? null);
    if (leftFishing && rightFishing && seat.left && seat.right) {
      sectors.push({
        sectorId: seat.sectorId,
        kind: "pair",
        leftSlotId: seat.left.slotId,
        rightSlotId: seat.right.slotId,
      });
      continue;
    }

    const loneSlot = leftFishing ? seat.left : rightFishing ? seat.right : null;
    if (!loneSlot) continue;
    const opponent = loneSlot.opponentSlotId ? byId.get(loneSlot.opponentSlotId) : undefined;
    sectors.push({
      sectorId: seat.sectorId,
      kind: "lone",
      slotId: loneSlot.slotId,
      side: drawnSide(loneSlot),
      vacant: isGhostOpponent(loneSlot.opponentSlotId) || opponent?.ghost === true,
      neighborSlotId: gridNeighbor(slots, loneSlot, ghosts),
    });
  }

  return sectors;
}

export interface PeriodSeat {
  sectorId: string;
  /** С кем сравниваются поимки: соперник пары или сосед одиночки. */
  opponentSlotId: string | null;
  /** Соперник в сетке Бергера. У одиночки это GHOST. */
  bergerOpponentSlotId: string | null;
}

/** Сектор, соперник Бергера и соперник для счёта в одном периоде. */
export function periodSeat(
  grid: readonly GridSlot[],
  participants: readonly RegisteredParticipant[],
  slotId: string,
  period: PeriodIndex,
): PeriodSeat | null {
  const drawn = grid.find((slot) => slot.round === 1 && slot.period === period && slot.slotId === slotId);
  if (!drawn) return null;

  const sectors = sectorsForPeriod(grid, participants, period);
  for (const sector of sectors) {
    if (sector.kind === "pair") {
      if (sector.leftSlotId === slotId) {
        return { sectorId: sector.sectorId, opponentSlotId: sector.rightSlotId, bergerOpponentSlotId: drawn.opponentSlotId };
      }
      if (sector.rightSlotId === slotId) {
        return { sectorId: sector.sectorId, opponentSlotId: sector.leftSlotId, bergerOpponentSlotId: drawn.opponentSlotId };
      }
    } else if (sector.slotId === slotId) {
      return {
        sectorId: sector.sectorId,
        opponentSlotId: sector.neighborSlotId,
        bergerOpponentSlotId: drawn.opponentSlotId,
      };
    }
  }

  return { sectorId: drawn.sectorId, opponentSlotId: null, bergerOpponentSlotId: drawn.opponentSlotId };
}

/** Другое место того же сектора в первом периоде, если там фантом или GHOST. */
export function ghostSeatPartner(
  participants: readonly RegisteredParticipant[],
  _sectorCount: number,
  slotId: string,
): RegisteredParticipant | null {
  const slot = gridOf(participants, 1).find((item) => item.period === 1 && item.slotId === slotId);
  if (!slot?.opponentSlotId || isGhostOpponent(slot.opponentSlotId)) return null;
  const partner = participants.find((participant) => participant.slotId === slot.opponentSlotId);
  return partner?.ghost ? partner : null;
}

/** Ближайший живой сосед по карте секторов первого периода. Очки одиночки считаются против него. */
export function loneNeighborSlotId(
  participants: readonly RegisteredParticipant[],
  _sectorCount: number,
  loneSlotId: string,
): string | null {
  const grid = gridOf(participants, 1);
  const slot = grid.find((item) => item.period === 1 && item.slotId === loneSlotId);
  if (!slot || !isGhostOpponent(slot.opponentSlotId)) {
    const opponent = slot?.opponentSlotId
      ? participants.find((participant) => participant.slotId === slot.opponentSlotId)
      : undefined;
    if (opponent && !opponent.ghost) return null;
  }
  const ghosts = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
  return comparisonNeighborFromGrid(grid, loneSlotId, 1, 1, ghosts);
}

export function waitingParticipants(
  participants: readonly RegisteredParticipant[],
  sectorCount: number,
): RegisteredParticipant[] {
  const seated = new Set<string>();
  for (const duel of planPeriodOne(participants, sectorCount)) {
    if (duel.kind === "pair") {
      seated.add(duel.leftSlotId);
      seated.add(duel.rightSlotId);
    } else {
      seated.add(duel.loneSlotId);
    }
  }
  return participants.filter((participant) => !participant.ghost && !seated.has(participant.slotId));
}

function gridOf(participants: readonly RegisteredParticipant[], periodsCount: number): GridSlot[] {
  const fishing = [...participants].filter((participant) => !participant.ghost).sort(byBib);
  return generateTournamentGrid(
    fishing.map((participant) => participant.slotId),
    periodsCount,
    fishing.map((participant) => participant.bibNumber),
  );
}

function matrixFromGrid(grid: readonly GridSlot[], participants: readonly RegisteredParticipant[]): MatrixDuel[] {
  const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
  const grouped = new Map<string, GridSlot[]>();
  for (const slot of grid) {
    const key = `${slot.round}:${slot.period}:${slot.sectorId}`;
    const list = grouped.get(key) ?? [];
    list.push(slot);
    grouped.set(key, list);
  }

  const matrix: MatrixDuel[] = [];
  const keys = [...grouped.keys()].sort((left, right) => compareMatrixKey(left) - compareMatrixKey(right) || left.localeCompare(right));
  for (const key of keys) {
    const slots = grouped.get(key) ?? [];
    const left = slots.find((slot) => drawnSide(slot) === "left");
    const right = slots.find((slot) => drawnSide(slot) === "right");
    const sample = left ?? right;
    if (!sample) continue;

    const leftPerson = left ? byId.get(left.slotId) : undefined;
    const rightPerson = right ? byId.get(right.slotId) : undefined;
    const leftFishing = isFishing(leftPerson ?? null);
    const rightFishing = isFishing(rightPerson ?? null);
    const owner = (leftFishing ? leftPerson : rightFishing ? rightPerson : leftPerson) ?? null;
    if (!owner) continue;
    const groupId = owner.groupId;
    const zoneId = zoneOf(groupId, sample.round);

    if (leftFishing && rightFishing && left && right) {
      matrix.push({
        kind: "pair",
        round: sample.round,
        period: sample.period,
        groupId,
        zoneId,
        sectorId: sample.sectorId,
        leftSlotId: left.slotId,
        rightSlotId: right.slotId,
      });
      continue;
    }

    const lone = leftFishing && left ? left : rightFishing && right ? right : null;
    if (!lone) continue;
    matrix.push({
      kind: "lone",
      round: sample.round,
      period: sample.period,
      groupId,
      zoneId,
      sectorId: sample.sectorId,
      loneSlotId: lone.slotId,
    });
  }
  return matrix;
}

function compareMatrixKey(key: string): number {
  const [round = "0", period = "0", sector = "0"] = key.split(":");
  return Number(round) * 1000 + Number(period) * 100 + Number(sector);
}

function zoneOf(groupId: GroupId, round: RoundIndex): ZoneId {
  if (groupId === "A") return round === 1 ? "blue" : "red";
  return round === 1 ? "red" : "blue";
}

function drawnSide(slot: GridSlot): Side {
  return slot.side;
}

interface GridSeat {
  sectorId: string;
  order: number;
  left: GridSlot | null;
  right: GridSlot | null;
}

function gridSeats(slots: readonly GridSlot[]): GridSeat[] {
  const bySector = new Map<string, GridSeat>();
  for (const slot of slots) {
    const seat = bySector.get(slot.sectorId) ?? {
      sectorId: slot.sectorId,
      order: Number(slot.sectorId),
      left: null,
      right: null,
    };
    if (drawnSide(slot) === "right") seat.right = slot;
    else seat.left = slot;
    bySector.set(slot.sectorId, seat);
  }
  return [...bySector.values()].sort(
    (left, right) => left.order - right.order || left.sectorId.localeCompare(right.sectorId, undefined, { numeric: true }),
  );
}

function gridNeighbor(slots: readonly GridSlot[], lone: GridSlot, ghosts: ReadonlySet<string>): string | null {
  return comparisonNeighborFromGrid(slots, lone.slotId, lone.period, lone.round, ghosts);
}

function viewFromGrid(
  participants: readonly RegisteredParticipant[],
  grid: readonly GridSlot[],
  slot: GridSlot,
): SectorView {
  const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
  const athlete = byId.get(slot.slotId);
  const opponent = slot.opponentSlotId && !isGhostOpponent(slot.opponentSlotId) ? byId.get(slot.opponentSlotId) : undefined;
  const sideLabel = drawnSide(slot) === "left" ? "СЛЕВА" : "СПРАВА";
  const periodSlots = grid.filter((item) => item.round === slot.round && item.period === slot.period);
  const ghosts = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));

  if (opponent && !opponent.ghost) {
    return {
      sectorLabel: slot.sectorId,
      sideLabel,
      athleteSlotId: slot.slotId,
      opponentSlotId: opponent.slotId,
      athleteName: athleteLabel(athlete),
      opponentName: athleteLabel(opponent),
      briefing: `Вы в секторе ${slot.sectorId} ${sideLabel}, ваш соперник ${opponent.displayName}`,
      neighborLabel: "",
    };
  }

  const neighborId = gridNeighbor(periodSlots, slot, ghosts);
  const neighbor = neighborId ? byId.get(neighborId) : undefined;
  return {
    sectorLabel: slot.sectorId,
    sideLabel,
    athleteSlotId: slot.slotId,
    opponentSlotId: "",
    athleteName: athleteLabel(athlete),
    opponentName: "Вы один",
    briefing: `Вы в секторе ${slot.sectorId} ${sideLabel}`,
    neighborLabel: neighborCardLabel(neighbor),
  };
}

function neighborCardLabel(participant: RegisteredParticipant | undefined): string {
  if (!participant) return "сосед не определён";
  const auto = numberedAthleteName(participant.bibNumber);
  if (participant.displayName.trim() === auto) return auto;
  return `Спортсмен №${participant.bibNumber} ${participant.displayName.trim()}`;
}

function athleteLabel(participant: RegisteredParticipant | undefined): string {
  if (!participant) return "—";
  return `${participant.bibNumber}. ${participant.displayName}`;
}

/** Поимки «ПЛЮС»/«МИНУС» ещё не в IndexedDB, но уже должны двигать места. */
function unconfirmedCatches(state: MatchStore): TournamentEvent[] {
  if (!state.tournamentOpened || state.saving || state.pending.length === 0) return [];
  const timestamp = Date.now();
  return state.pending.map((catchEvent, index) => ({
    id: `pending:${timestamp}:${index}:${catchEvent.slotId}`,
    tournamentId: state.tournamentId,
    type: "CATCH_RECORDED",
    timestamp: timestamp + index,
    payload: {
      slotId: catchEvent.slotId,
      round: state.round,
      period: state.period,
      delta: catchEvent.delta,
    },
  }));
}

async function commitParticipantUpdate(
  set: (partial: Partial<MatchStore>) => void,
  previous: readonly RegisteredParticipant[],
  slotId: string,
  next: RegisteredParticipant,
  event: TournamentEvent,
  labels?: {
    optimistic: Pick<SectorView, "athleteName" | "opponentName" | "briefing" | "neighborLabel"> & {
      leaderboard?: LeaderboardEntry[];
    };
    rollback: Pick<SectorView, "athleteName" | "opponentName" | "briefing" | "neighborLabel"> & {
      leaderboard?: LeaderboardEntry[];
    };
  },
): Promise<boolean> {
  set({
    participants: previous.map((participant) => (participant.slotId === slotId ? next : participant)),
    ...labels?.optimistic,
    setupSaving: true,
    setupError: null,
  });

  try {
    await db.events.add(toRecord(event));
    set({ setupSaving: false });
    return true;
  } catch (error) {
    set({
      setupSaving: false,
      participants: [...previous],
      ...labels?.rollback,
      setupError: error instanceof Error ? error.message : "Не удалось обновить участника",
    });
    return false;
  }
}

/** До старта лист плотный: без фантомов и без пропусков в номерах. */
function denseStartList(participants: readonly RegisteredParticipant[]): RegisteredParticipant[] {
  return [...participants]
    .filter((participant) => !participant.ghost)
    .sort(byBib)
    .map((participant, index) => {
      const bibNumber = index + 1;
      const displayName = isAutoName(participant.displayName, participant.bibNumber)
        ? numberedAthleteName(bibNumber)
        : participant.displayName;
      return { ...participant, bibNumber, displayName, ghost: false };
    });
}

function registrationName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function registrationKey(value: string): string {
  return registrationName(value).toLocaleLowerCase("ru");
}

function isAutoName(displayName: string, bibNumber: number): boolean {
  return displayName === numberedAthleteName(bibNumber) || displayName === phantomName(bibNumber);
}

/** Настоящее ФИО: не короче трёх символов и не служебное «Спортсмен №N» / «ФАНТОМ N». */
export function isRealAthleteName(displayName: string, bibNumber: number): boolean {
  const name = displayName.trim().replace(/\s+/g, " ");
  return name.length >= 3 && !isAutoName(name, bibNumber);
}

function hasSavedRealName(state: MatchStore, slotId: string): boolean {
  if (!slotId || !state.playerNamedSlotIds.includes(slotId)) return false;
  const participant = state.participants.find((item) => item.slotId === slotId);
  if (!participant || participant.ghost) return false;
  return isRealAthleteName(participant.displayName, participant.bibNumber);
}

function sameRoster(left: readonly RegisteredParticipant[], right: readonly RegisteredParticipant[]): boolean {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort(byBib);
  const orderedRight = [...right].sort(byBib);
  return orderedLeft.every((participant, index) => {
    const other = orderedRight[index];
    return (
      other !== undefined &&
      participant.slotId === other.slotId &&
      participant.bibNumber === other.bibNumber &&
      participant.displayName === other.displayName &&
      participant.groupId === other.groupId &&
      participant.ghost === other.ghost
    );
  });
}

async function healedStartList(
  tournamentId: string,
  participants: readonly RegisteredParticipant[],
): Promise<RegisteredParticipant[]> {
  const dense = denseStartList(participants);
  if (sameRoster(participants, dense)) return [...participants];
  await persistDenseRoster(tournamentId, dense);
  return dense;
}

function rosterSlotId(event: TournamentEvent): string | null {
  switch (event.type) {
    case "PARTICIPANT_REGISTERED":
    case "PARTICIPANT_REPLACED":
    case "PARTICIPANT_SET_GHOST":
    case "PARTICIPANT_REMOVED":
      return event.payload.slotId;
    default:
      return null;
  }
}

/** Стирает снятых игроков из журнала и записывает сомкнутые номера оставшимся. */
async function persistDenseRoster(
  tournamentId: string,
  next: readonly RegisteredParticipant[],
): Promise<void> {
  const keep = new Map(next.map((participant) => [participant.slotId, participant]));
  await db.transaction("rw", db.events, async () => {
    const rows = await db.events.where("tournamentId").equals(tournamentId).toArray();
    const registeredBib = new Map<string, number>();
    for (const row of rows) {
      if (row.event.type === "PARTICIPANT_REGISTERED") {
        registeredBib.set(row.event.payload.slotId, row.event.payload.bibNumber);
      }
    }

    const deleteIds: string[] = [];
    for (const row of rows) {
      const slotId = rosterSlotId(row.event);
      if (slotId === null) continue;
      const kept = keep.get(slotId);
      if (!kept || row.event.type === "PARTICIPANT_REMOVED" || row.event.type === "PARTICIPANT_SET_GHOST") {
        deleteIds.push(row.id);
        continue;
      }
      if (row.event.type === "PARTICIPANT_REGISTERED") {
        const previousBib = row.event.payload.bibNumber;
        const displayName = isAutoName(row.event.payload.displayName, previousBib)
          ? numberedAthleteName(kept.bibNumber)
          : row.event.payload.displayName;
        if (previousBib === kept.bibNumber && displayName === row.event.payload.displayName) continue;
        await db.events.update(row.id, {
          event: {
            ...row.event,
            payload: {
              ...row.event.payload,
              bibNumber: kept.bibNumber,
              displayName,
            },
          },
        });
        continue;
      }
      if (row.event.type !== "PARTICIPANT_REPLACED") continue;
      const previousBib = registeredBib.get(slotId);
      if (previousBib === undefined || !isAutoName(row.event.payload.displayName, previousBib)) continue;
      const displayName = numberedAthleteName(kept.bibNumber);
      if (displayName === row.event.payload.displayName) continue;
      await db.events.update(row.id, {
        event: {
          ...row.event,
          payload: { ...row.event.payload, displayName },
        },
      });
    }
    if (deleteIds.length > 0) await db.events.bulkDelete(deleteIds);
  });
}

async function dropParticipants(
  set: (partial: Partial<MatchStore>) => void,
  state: MatchStore,
  slotIds: readonly string[],
): Promise<boolean> {
  const removing = new Set(slotIds);
  const previous = state.participants;
  const kept = previous.filter((participant) => !removing.has(participant.slotId));
  if (kept.length === previous.length) return false;

  const nextParticipants = denseStartList(kept);
  const named = state.playerNamedSlotIds.filter((slotId) =>
    nextParticipants.some((participant) => participant.slotId === slotId),
  );
  set({
    participants: nextParticipants,
    playerNamedSlotIds: named,
    sectorCount: requiredSectorCount(nextParticipants.length),
    setupSaving: true,
    setupError: null,
  });

  try {
    await persistDenseRoster(state.tournamentId, nextParticipants);
    set({ setupSaving: false });
    return true;
  } catch (error) {
    set({
      setupSaving: false,
      participants: [...previous],
      playerNamedSlotIds: state.playerNamedSlotIds,
      sectorCount: requiredSectorCount(previous.length),
      setupError: error instanceof Error ? error.message : "Не удалось удалить участника",
    });
    return false;
  }
}

async function appendRegisteredParticipants(
  set: (partial: Partial<MatchStore>) => void,
  state: MatchStore,
  entries: readonly RegistrationBatchEntry[],
): Promise<boolean> {
  const roster = denseStartList(state.participants);
  const normalized = normalizeRegistrationEntries(entries, roster);
  if (!normalized.ok) {
    set({ setupError: normalized.error });
    return false;
  }

  const timestamp = Date.now();
  const events: TournamentEvent[] = normalized.participants.map((participant, index) => ({
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "PARTICIPANT_REGISTERED",
    timestamp: timestamp + index,
    payload: {
      slotId: participant.slotId,
      bibNumber: participant.bibNumber,
      displayName: participant.displayName,
      groupId: participant.groupId,
    },
  }));
  const nextParticipants = [...roster, ...normalized.participants].sort(byBib);

  set({
    participants: nextParticipants,
    sectorCount: requiredSectorCount(nextParticipants.length),
    setupSaving: true,
    setupError: null,
  });

  let rosterSaved = sameRoster(state.participants, roster);
  try {
    if (!rosterSaved) {
      await persistDenseRoster(state.tournamentId, roster);
      rosterSaved = true;
    }
    await db.events.bulkAdd(events.map(toRecord));
    set({ setupSaving: false });
    return true;
  } catch (error) {
    const restored = rosterSaved ? roster : state.participants;
    set({
      setupSaving: false,
      participants: [...restored],
      sectorCount: requiredSectorCount(restored.length),
      setupError: error instanceof Error ? error.message : "Не удалось записать участников",
    });
    return false;
  }
}

function normalizeRegistrationEntries(
  entries: readonly RegistrationBatchEntry[],
  existing: readonly RegisteredParticipant[],
): { ok: true; participants: RegisteredParticipant[] } | { ok: false; error: string } {
  if (entries.length === 0) return { ok: false, error: "В пачке нет участников" };
  if (existing.length + entries.length > MAX_REGISTRATION_BATCH) {
    return { ok: false, error: `В стартовом листе не больше ${MAX_REGISTRATION_BATCH} участников` };
  }

  const used = new Set(existing.map((participant) => participant.bibNumber));
  let nextBib = existing.reduce((max, participant) => Math.max(max, participant.bibNumber), 0);
  const participants: RegisteredParticipant[] = [];

  for (const entry of entries) {
    const displayName = entry.displayName.trim();
    if (!displayName) return { ok: false, error: "У участника нет имени" };
    const groupId = entry.groupId ?? "A";
    if (groupId !== "A" && groupId !== "B") return { ok: false, error: "Группа должна быть A или B" };

    let bibNumber = entry.bibNumber;
    if (bibNumber === undefined) {
      nextBib += 1;
      bibNumber = nextBib;
    } else if (!Number.isInteger(bibNumber) || bibNumber < 1) {
      return { ok: false, error: "Номер жеребьёвки должен быть целым числом от 1" };
    }
    if (used.has(bibNumber)) return { ok: false, error: `Номер ${bibNumber} уже занят` };
    used.add(bibNumber);
    nextBib = Math.max(nextBib, bibNumber);
    participants.push({
      slotId: crypto.randomUUID(),
      bibNumber,
      displayName,
      groupId,
      ghost: false,
    });
  }

  return { ok: true, participants };
}

function isFishing(participant: RegisteredParticipant | null): participant is RegisteredParticipant {
  return participant !== null && !participant.ghost;
}

function loneComparisonEvents(
  tournamentId: string,
  participants: readonly RegisteredParticipant[],
  grid: readonly GridSlot[],
  timestamp: number,
): TournamentEvent[] {
  const ghosts = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
  const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
  const events: TournamentEvent[] = [];
  const seen = new Set<string>();

  for (const slot of grid) {
    if (ghosts.has(slot.slotId)) continue;
    const opponent = slot.opponentSlotId ? byId.get(slot.opponentSlotId) : undefined;
    if (opponent && !opponent.ghost) continue;
    const key = `${slot.round}:${slot.period}:${slot.slotId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const periodSlots = grid.filter((item) => item.round === slot.round && item.period === slot.period);
    const neighborSlotId = gridNeighbor(periodSlots, slot, ghosts);
    if (!neighborSlotId) continue;
    events.push({
      id: crypto.randomUUID(),
      tournamentId,
      type: "LONE_COMPARED",
      timestamp: timestamp + events.length,
      payload: {
        round: slot.round,
        period: slot.period,
        loneSlotId: slot.slotId,
        neighborSlotId,
        source: "sectors",
      },
    });
  }
  return events;
}

function renamedLabels(
  state: MatchStore,
  bibNumber: number,
  slotId: string,
  displayName: string,
): Pick<SectorView, "athleteName" | "opponentName" | "briefing" | "neighborLabel"> {
  const participants = state.participants.map((participant) =>
    participant.slotId === slotId
      ? { ...participant, bibNumber: participant.bibNumber, displayName, ghost: state.tournamentOpened ? participant.ghost : false }
      : participant,
  );
  if (state.playoff.formed && state.selectedPlayoffMatchId) {
    const match = playoffMatches(state.playoff).find((item) => item.matchId === state.selectedPlayoffMatchId);
    if (match) {
      const view = viewFromPlayoff(participants, match);
      return {
        athleteName: view.athleteName,
        opponentName: view.opponentName,
        briefing: view.briefing,
        neighborLabel: view.neighborLabel,
      };
    }
  }
  const label = `${bibNumber}. ${displayName}`;
  const slot = state.grid.find(
    (item) => item.slotId === state.athleteSlotId && item.round === state.round && item.period === state.period,
  );
  const view = slot ? viewFromGrid(participants, state.grid, slot) : null;
  return {
    athleteName: state.athleteSlotId === slotId ? label : (view?.athleteName ?? state.athleteName),
    opponentName: state.opponentSlotId === slotId ? label : (view?.opponentName ?? state.opponentName),
    briefing: view?.briefing ?? state.briefing,
    neighborLabel: view?.neighborLabel ?? state.neighborLabel,
  };
}

function byBib(left: RegisteredParticipant, right: RegisteredParticipant): number {
  return left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId);
}

/** Числа с экрана становятся итогом периода: старые дельты этого периода для пары удаляются. */
function absoluteCatches(state: MatchStore, slotIds: readonly string[], timestamp: number): TournamentEvent[] {
  const countOf = new Map<string, number>();
  if (state.athleteSlotId) countOf.set(state.athleteSlotId, state.athleteFish);
  if (state.opponentSlotId) countOf.set(state.opponentSlotId, state.opponentFish);

  const events: TournamentEvent[] = [];
  for (const slotId of slotIds) {
    const count = countOf.get(slotId) ?? 0;
    for (let index = 0; index < count; index += 1) {
      events.push({
        id: crypto.randomUUID(),
        tournamentId: state.tournamentId,
        type: "CATCH_RECORDED",
        timestamp: timestamp + events.length,
        payload: {
          slotId,
          round: state.round,
          period: state.period,
          delta: 1,
        },
      });
    }
  }
  return events;
}

function clampFish(fish: number): number | null {
  if (!Number.isFinite(fish)) return null;
  return Math.max(0, Math.min(9999, Math.trunc(fish)));
}

function catchEventsForCounts(
  tournamentId: string,
  period: PeriodIndex,
  counts: ReadonlyMap<string, number>,
  timestamp: number,
): TournamentEvent[] {
  const events: TournamentEvent[] = [];
  for (const [slotId, count] of counts) {
    for (let index = 0; index < count; index += 1) {
      events.push({
        id: crypto.randomUUID(),
        tournamentId,
        type: "CATCH_RECORDED",
        timestamp: timestamp + events.length,
        payload: {
          slotId,
          round: 1,
          period,
          delta: 1,
        },
      });
    }
  }
  return events;
}

async function replacePeriodCatches(
  tournamentId: string,
  round: RoundIndex,
  period: PeriodIndex,
  slotIds: readonly string[],
  events: readonly TournamentEvent[],
  synced = false,
): Promise<void> {
  const replacing = new Set(slotIds);
  await db.transaction("rw", db.events, async () => {
    const rows = await db.events.where("tournamentId").equals(tournamentId).toArray();
    const staleIds = rows.flatMap((row) => {
      const event = row.event;
      if (event.type !== "CATCH_RECORDED") return [];
      if (event.payload.round !== round || event.payload.period !== period) return [];
      if (!replacing.has(event.payload.slotId)) return [];
      return [row.id];
    });
    if (staleIds.length > 0) await db.events.bulkDelete(staleIds);
    if (events.length > 0) {
      await db.events.bulkAdd(events.map((event) => (synced ? toSyncedRecord(event) : toRecord(event))));
    }
  });
}

function isQualifyingPeriod(period: PeriodIndex): boolean {
  return (QUALIFYING_PERIODS as readonly PeriodIndex[]).includes(period);
}

function allQualifyingPeriodsClosed(closed: ReadonlySet<PeriodIndex>): boolean {
  return QUALIFYING_PERIODS.every((period) => closed.has(period));
}

/** Период отбора засчитан только если в журнале есть и протокол, и записанные поимки. */
function qualifyingJournalStatus(
  events: readonly TournamentEvent[],
  slotId: string,
): { ready: boolean; saved: number } {
  const closed = closedQualifyingPeriods(events, slotId);
  const entry = tournamentCalculator.generateLeaderboard(events).find((item) => item.slotId === slotId);
  let saved = 0;
  for (const period of QUALIFYING_PERIODS) {
    const cell = entry?.periods.find((item) => item.period === period);
    if (closed.has(period) && cell?.played) saved += 1;
  }
  return { ready: saved === QUALIFYING_PERIODS.length, saved };
}

function journalPeriodScore(
  leaderboard: readonly LeaderboardEntry[],
  slotId: string,
  period: PeriodIndex,
): { athleteFish: number; opponentFish: number; confirmed: boolean } {
  const cell = leaderboard.find((entry) => entry.slotId === slotId)?.periods.find((item) => item.period === period);
  if (!cell?.played) return { athleteFish: 0, opponentFish: 0, confirmed: false };
  return { athleteFish: cell.fish, opponentFish: cell.opponentFish, confirmed: true };
}

async function readJournal(get: () => MatchStore, set: (partial: Partial<MatchStore>) => void): Promise<void> {
  let tournamentId = await resolveTournamentId(get().tournamentId);
  if (tournamentId === "local-session") tournamentId = await separatePlaceholderTournament();
  if (tournamentId !== get().tournamentId) set({ tournamentId });
  try {
    const [rows, outboxQueue, duelConflicts, device] = await Promise.all([
      db.events.where("tournamentId").equals(tournamentId).sortBy("timestamp"),
      db.outboxQueue.orderBy("createdAt").toArray(),
      db.duelConflicts.toArray(),
      db.deviceState.get(PLAYER_DEVICE_ID),
    ]);
    const stored = rows.map((row) => row.event);
    const snapshot = readSetup(stored);
    const participants = snapshot.tournamentOpened
      ? snapshot.participants
      : await healedStartList(tournamentId, snapshot.participants);
    const grid = snapshot.tournamentOpened ? gridOf(participants, snapshot.periodsPerRound) : [];
    const signal = snapshot.tournamentOpened
      ? publishedPeriod(stored)
      : { period: 1 as PeriodIndex, phase: "waiting" as const, officiallyStarted: false };
    set({
      participants,
      grid,
      tournamentOpened: snapshot.tournamentOpened,
      tournamentName: snapshot.tournamentName,
      tournamentDate: snapshot.tournamentDate,
      sectorCount: snapshot.tournamentOpened ? snapshot.sectorCount : requiredSectorCount(participants.length),
      periodsCount: snapshot.periodsPerRound,
      hydrated: false,
      setupError: null,
      period: signal.period,
      periodPhase: signal.phase,
      officiallyStarted: signal.officiallyStarted,
      playerNamedSlotIds: playerNamedFromEvents(stored).filter((slotId) =>
        participants.some((participant) => participant.slotId === slotId),
      ),
      ...emptySector,
      ...cupPatch(stored, participants, grid),
      selectedPlayoffMatchId: "",
      playoffEntryOpen: false,
      outboxQueue,
      duelConflicts,
      syncNote: null,
      athleteFish: 0,
      opponentFish: 0,
      pending: [],
      confirmed: false,
      savedCount: null,
    });
    await get().loadLeaderboard();
    restoreRememberedPlayer(get, device?.athleteSlotId ?? "");
    await get().refreshHandoff();
    set({ hydrated: true, setupError: null });
  } catch (error) {
    set({
      hydrated: true,
      setupError: error instanceof Error ? error.message : "Не удалось прочитать журнал турнира",
    });
  }
}

function restoreRememberedPlayer(get: () => MatchStore, slotId: string): void {
  const remembered = slotId.trim();
  if (!remembered || !get().tournamentOpened) {
    openRememberedPlayoff(get);
    return;
  }
  const participant = get().participants.find((item) => item.slotId === remembered && !item.ghost);
  if (!participant) {
    forgetAthleteSlot();
    openRememberedPlayoff(get);
    return;
  }
  get().selectAthlete(remembered);
  if (!get().playoff.formed) return;
  const mine =
    playoffMatches(get().playoff).find(
      (match) => Boolean(match.slotIdA && match.slotIdB) && (match.slotIdA === remembered || match.slotIdB === remembered),
    ) ?? firstOpenPlayoffMatch(get);
  if (mine) get().selectPlayoffMatch(mine.matchId);
}

function openRememberedPlayoff(get: () => MatchStore): void {
  const opening = firstOpenPlayoffMatch(get);
  if (opening) get().selectPlayoffMatch(opening.matchId);
}

function firstOpenPlayoffMatch(get: () => MatchStore) {
  const playoff = get().playoff;
  return (
    playoffMatches(playoff).find((match) => match.slotIdA && match.slotIdB && !match.winnerSlotId) ??
    playoffMatches(playoff).find((match) => match.slotIdA && match.slotIdB)
  );
}

function closedQualifyingPeriods(events: readonly TournamentEvent[], slotId: string): Set<PeriodIndex> {
  const closed = new Set<PeriodIndex>();
  for (const event of events) {
    if (event.type !== "PERIOD_COMPLETED" || event.payload.round !== 1) continue;
    if (!isQualifyingPeriod(event.payload.period)) continue;
    const covers = event.payload.protocols.some(
      (protocol) => protocol.signed && (protocol.slotIdA === slotId || protocol.slotIdB === slotId),
    );
    if (covers) closed.add(event.payload.period);
  }
  return closed;
}

function cupPatch(
  events: readonly TournamentEvent[],
  participants: readonly RegisteredParticipant[],
  grid: readonly GridSlot[],
): Pick<MatchStore, "playoff" | "eighthPeriodClosed"> {
  return {
    playoff: projectPlayoff(events),
    eighthPeriodClosed: isEighthPeriodClosed(events, participants, grid),
  };
}

function isEighthPeriodClosed(
  events: readonly TournamentEvent[],
  participants: readonly RegisteredParticipant[],
  grid: readonly GridSlot[],
): boolean {
  const ghosts = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
  const required = new Set(
    grid
      .filter((slot) => slot.round === 1 && slot.period === PERIODS_PER_ROUND && !ghosts.has(slot.slotId))
      .map((slot) => slot.slotId),
  );
  if (required.size === 0) return false;

  const covered = new Set<string>();
  for (const event of events) {
    if (event.type !== "PERIOD_COMPLETED" || event.payload.round !== 1 || event.payload.period !== PERIODS_PER_ROUND) continue;
    for (const protocol of event.payload.protocols) {
      if (!protocol.signed) continue;
      covered.add(protocol.slotIdA);
      if (protocol.slotIdB) covered.add(protocol.slotIdB);
    }
  }
  for (const slotId of required) {
    if (!covered.has(slotId)) return false;
  }
  return true;
}

function viewFromPlayoff(participants: readonly RegisteredParticipant[], match: PlayoffBracketMatch): SectorView {
  const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
  const athlete = match.slotIdA ? byId.get(match.slotIdA) : undefined;
  const opponent = match.slotIdB ? byId.get(match.slotIdB) : undefined;
  const stage =
    match.stage === "quarterfinal"
      ? "1/4 финала"
      : match.stage === "semifinal"
        ? "1/2 финала"
        : match.stage === "third"
          ? "Матч за 3-е место"
          : "Финал";
  const stageShort =
    match.stage === "quarterfinal" ? "1/4" : match.stage === "semifinal" ? "1/2" : match.stage === "third" ? "3-е" : "ФИНАЛ";
  return {
    sectorLabel: stageShort,
    sideLabel: "СЛЕВА",
    athleteSlotId: match.slotIdA ?? "",
    opponentSlotId: match.slotIdB ?? "",
    athleteName: athleteLabel(athlete),
    opponentName: athleteLabel(opponent),
    briefing: `${stage}: ${athlete?.displayName ?? "—"} (место ${match.placeA ?? "—"}) против ${opponent?.displayName ?? "—"} (место ${match.placeB ?? "—"}). Ничья основного времени решается доп. 5-минуткой, затем «Золотой рыбой». Если за 10 минут никто не поймал, проходит более высокое место группы.`,
    neighborLabel: "",
  };
}

async function savePlayoffDuel(get: () => MatchStore, set: (partial: Partial<MatchStore>) => void): Promise<void> {
  const state = get();
  if (state.saving || !state.playoff.formed || !state.selectedPlayoffMatchId) return;
  const match = playoffMatches(state.playoff).find((item) => item.matchId === state.selectedPlayoffMatchId);
  if (!match?.slotIdA || !match.slotIdB || match.placeA === null || match.placeB === null || match.seedA === null || match.seedB === null) {
    set({ error: "Эта пара ещё не собрана" });
    return;
  }

  const decision = scorePlayoffDuel({
    fishA: state.athleteFish,
    fishB: state.opponentFish,
    extraFishA: state.athleteExtraFish,
    extraFishB: state.opponentExtraFish,
    goldenFishA: state.athleteGoldenFish,
    goldenFishB: state.opponentGoldenFish,
    goldenFirst: state.goldenFirst,
    placeA: match.placeA,
    seedA: match.seedA,
    placeB: match.placeB,
    seedB: match.seedB,
  });
  if (!decision.winner || !decision.decidedBy) {
    set({ error: "Отметьте, кто первым поймал золотую рыбу" });
    return;
  }

  const event: TournamentEvent = {
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "PLAYOFF_DUEL_SCORED",
    timestamp: Date.now(),
    payload: {
      matchId: match.matchId,
      slotIdA: match.slotIdA,
      slotIdB: match.slotIdB,
      fishA: decision.fishA,
      fishB: decision.fishB,
      extraFishA: decision.extraFishA ?? 0,
      extraFishB: decision.extraFishB ?? 0,
      goldenFishA: decision.goldenFishA ?? 0,
      goldenFishB: decision.goldenFishB ?? 0,
      goldenFirst: decision.goldenFirst,
    },
  };

  set({ saving: true, error: null });
  try {
    const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
    const after = withPlayoffDuel(rows.map((row) => row.event), event);
    await replaceEventLog(rows, after, false);
    const playoff = projectPlayoff(after);
    set({ saving: false, playoff, confirmed: true, pending: [], savedCount: 1, playoffEntryOpen: false });
    const next = playoffMatches(playoff).find((item) => item.slotIdA && item.slotIdB && !item.winnerSlotId);
    get().selectPlayoffMatch((next ?? match).matchId);
    await get().refreshHandoff();
  } catch (error) {
    set({
      saving: false,
      error: error instanceof Error ? error.message : "Не удалось записать дуэль",
    });
  }
}

async function importPlayoffSnapshot(
  get: () => MatchStore,
  set: (partial: Partial<MatchStore>) => void,
  participant: RegisteredParticipant,
  cells: readonly QrPlayoffCell[],
  markLabel?: string,
): Promise<PlayerQrImportResult> {
  const state = get();
  if (!state.playoff.formed) return { ok: false, error: "Сначала сформируйте плей-офф" };

  try {
    const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
    let next: readonly TournamentEvent[] = rows.map((row) => row.event);
    const started = Date.now();
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      const updated = withPlayoffReport(next, {
        id: crypto.randomUUID(),
        tournamentId: state.tournamentId,
        timestamp: started + index,
        matchId: playoffMatchId(cell.stage, cell.pair),
        slotId: participant.slotId,
        fish: cell.fish,
      });
      if (updated === next) {
        return {
          ok: false,
          error: `${cupStageLabel(cell.stage)}, пара ${cell.pair}: игрок не в этой паре или пара ещё не собрана`,
        };
      }
      next = updated;
    }
    await replaceEventLog(rows, next, true);
    set({ playoff: projectPlayoff(next), playoffError: null });
    await get().loadLeaderboard();
    await get().refreshHandoff();
    const selected = get().selectedPlayoffMatchId;
    if (selected && cells.some((cell) => playoffMatchId(cell.stage, cell.pair) === selected)) {
      const live = playoffMatches(get().playoff).find((item) => item.matchId === selected);
      if (live?.winnerSlotId) get().selectPlayoffMatch(selected);
    }
    return {
      ok: true,
      packet: {
        bibNumber: participant.bibNumber,
        displayName: participant.displayName,
        fish: totalFish(cells),
        periods: cells.length,
        cup: describeCupImport(get().participants, get().playoff, cells),
        mark: markLabel,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось записать результаты",
    };
  }
}

function playoffSnapshot(state: MatchStore, records: readonly EventRecord[], slotId: string): QrPlayoffCell[] {
  const cells: QrPlayoffCell[] = [];
  for (const match of playoffMatches(state.playoff)) {
    if (match.slotIdA !== slotId && match.slotIdB !== slotId) continue;
    const fish = unsyncedPlayoffFish(records, match.matchId, slotId);
    if (fish === null) continue;
    cells.push({ stage: playoffStageCode(match.stage), pair: match.order + 1, fish });
  }
  return cells;
}

function unsyncedPlayoffFish(records: readonly EventRecord[], matchId: string, slotId: string): number | null {
  let fish: number | null = null;
  for (const record of records) {
    if (record.isSynced) continue;
    const event = record.event;
    if (event.type === "PLAYOFF_DUEL_SCORED" && event.payload.matchId === matchId) {
      if (event.payload.slotIdA === slotId) fish = event.payload.fishA;
      if (event.payload.slotIdB === slotId) fish = event.payload.fishB;
    } else if (
      event.type === "PLAYOFF_SIDE_REPORTED" &&
      event.payload.matchId === matchId &&
      event.payload.slotId === slotId
    ) {
      fish = event.payload.fish;
    }
  }
  return fish;
}

function describeCupImport(
  participants: readonly RegisteredParticipant[],
  playoff: PlayoffProjection,
  cells: readonly QrPlayoffCell[],
): string {
  const lines = cells.map((cell) => {
    const match = playoffMatches(playoff).find((item) => item.matchId === playoffMatchId(cell.stage, cell.pair));
    const title = `${cupStageLabel(cell.stage)}, пара ${cell.pair}`;
    if (!match || match.fishA === null || match.fishB === null || !match.winnerSlotId) {
      return `${title}: ${cell.fish} ${fishWord(cell.fish)}. Ждём соперника.`;
    }
    const winner = participants.find((item) => item.slotId === match.winnerSlotId);
    const winnerName = winner?.displayName ?? "победитель";
    const score = `${match.fishA}:${match.fishB}`;
    if (match.decidedBy === "extraTime") {
      return `${title}: ${score}, доп. ${match.extraFishA ?? 0}:${match.extraFishB ?? 0}. Дальше ${winnerName} — победа в доп. время.`;
    }
    if (match.decidedBy === "goldenFish") {
      return `${title}: ${score}. Дальше ${winnerName} — победа по золотой рыбе.`;
    }
    if (match.decidedBy === "qualifyingPlace") {
      return `${title}: ничья ${score}. Дальше ${winnerName} — по рейтингу группы.`;
    }
    return `${title}: ${score}. Дальше ${winnerName}.`;
  });
  return `${lines.join(" ")} Сетка обновлена.`;
}

function cupStageLabel(stage: QrPlayoffCell["stage"]): string {
  if (stage === "QF") return "Четвертьфинал";
  if (stage === "SF") return "Полуфинал";
  if (stage === "TF") return "Матч за 3-е место";
  return "Финал";
}

function fishWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "рыба";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "рыбы";
  return "рыб";
}

async function replaceEventLog(
  before: readonly EventRecord[],
  after: readonly TournamentEvent[],
  synced: boolean,
): Promise<void> {
  const afterIds = new Set(after.map((event) => event.id));
  const beforeIds = new Set(before.map((row) => row.id));
  const deleteIds = before.flatMap((row) => (afterIds.has(row.id) ? [] : [row.id]));
  const added = after.filter((event) => !beforeIds.has(event.id));
  await db.transaction("rw", db.events, async () => {
    if (deleteIds.length > 0) await db.events.bulkDelete(deleteIds);
    if (added.length > 0) await db.events.bulkAdd(added.map((event) => (synced ? toSyncedRecord(event) : toRecord(event))));
  });
}

function toRecord(event: TournamentEvent): EventRecord {
  return {
    id: event.id,
    tournamentId: event.tournamentId,
    type: event.type,
    timestamp: event.timestamp,
    isSynced: false,
    event,
  };
}

function toSyncedRecord(event: TournamentEvent): EventRecord {
  return { ...toRecord(event), isSynced: true };
}

const LOCAL_SAVE_NOTE = "Результат сохранен локально";
const NETWORK_SAVE_NOTE = "Результат синхронизирован по сети";

interface IngestReport {
  bibNumber: number;
  opponentBib: number | null;
  ownFish: number;
  opponentFish: number | null;
}

interface IngestMatch {
  period: number;
  status: SyncMatch["status"];
  reports: readonly IngestReport[];
}

/** Сначала журнал, потом очередь. Сеть только пытается отдать уже сохранённый пакет. */
async function enqueuePeriodReport(state: MatchStore): Promise<string> {
  const athlete = state.participants.find((item) => item.slotId === state.athleteSlotId);
  if (!athlete || athlete.ghost) return LOCAL_SAVE_NOTE;
  const opponent = state.opponentSlotId
    ? state.participants.find((item) => item.slotId === state.opponentSlotId)
    : undefined;
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    bibNumber: athlete.bibNumber,
    opponentBib: opponent && !opponent.ghost ? opponent.bibNumber : null,
    period: state.period,
    ownFish: state.athleteFish,
    opponentFish: state.opponentFish,
  };
  await db.outboxQueue.add(item);
  useMatchStore.setState({ outboxQueue: await db.outboxQueue.orderBy("createdAt").toArray() });
  if (typeof navigator === "undefined" || !navigator.onLine) return LOCAL_SAVE_NOTE;
  const sent = await postMatchReport({
    bibNumber: item.bibNumber,
    opponentBib: item.opponentBib,
    period: item.period,
    ownFish: item.ownFish,
    opponentFish: item.opponentFish,
  });
  if (!sent) return LOCAL_SAVE_NOTE;
  await db.outboxQueue.delete(item.id);
  useMatchStore.setState({ outboxQueue: await db.outboxQueue.orderBy("createdAt").toArray() });
  return NETWORK_SAVE_NOTE;
}

async function ingestMatch(get: () => MatchStore, match: IngestMatch): Promise<{ filled: number; conflicts: number }> {
  const state = get();
  if (!state.tournamentOpened || !isQualifyingPeriod(match.period as PeriodIndex)) return { filled: 0, conflicts: 0 };
  const period = match.period as PeriodIndex;
  const slots = duelSlotIds(state, match, period);
  if (slots.length === 0) return { filled: 0, conflicts: 0 };
  const fingerprint = matchFingerprint(match);

  if (match.status === "CONFLICT") {
    const opened = await flagDuel(slots, period, fingerprint, scoreDetail(match.reports));
    return { filled: 0, conflicts: opened > 0 ? 1 : 0 };
  }

  const targets = fishTargets(state, match, period);
  let events = await loadTournamentEvents(state.tournamentId);
  let filled = 0;
  const differs: { bib: number; was: number; incoming: number }[] = [];
  for (const target of targets) {
    const current = playedFish(events, target.slotId, period);
    if (current.played && current.fish !== target.fish) {
      differs.push({ bib: target.bibNumber, was: current.fish, incoming: target.fish });
      continue;
    }
    if (current.played) continue;
    const written = buildSlotEvents(state.tournamentId, period, target.slotId, target.fish);
    await replacePeriodCatches(state.tournamentId, 1, period, [target.slotId], written, true);
    events = events.concat(written);
    filled += 1;
  }

  if (differs.length > 0) {
    const detail =
      fullScoreDetail(match.reports) ??
      differs.map((item) => `№${item.bib}: в таблице ${item.was}, пришло ${item.incoming}`).join(", ");
    const opened = await flagDuel(slots, period, fingerprint, detail);
    return { filled, conflicts: opened > 0 ? 1 : 0 };
  }

  if (match.status === "CONFIRMED") await resolveSlots(slots, period);
  return { filled, conflicts: 0 };
}

function fishTargets(
  state: MatchStore,
  match: IngestMatch,
  period: PeriodIndex,
): { slotId: string; bibNumber: number; fish: number }[] {
  const targets: { slotId: string; bibNumber: number; fish: number }[] = [];
  const push = (bibNumber: number, fish: number) => {
    const player = livingByBib(state, bibNumber);
    if (!player || targets.some((item) => item.slotId === player.slotId)) return;
    targets.push({ slotId: player.slotId, bibNumber, fish });
  };

  if (match.status === "CONFIRMED") {
    for (const report of match.reports) push(report.bibNumber, report.ownFish);
    return targets;
  }

  const report = match.reports[0];
  if (!report) return targets;
  push(report.bibNumber, report.ownFish);
  if (report.opponentFish === null || report.opponentBib === null) return targets;
  const player = livingByBib(state, report.bibNumber);
  const opponent = livingByBib(state, report.opponentBib);
  if (!player || !opponent || !mutualPair(state, player.slotId, opponent.slotId, period)) return targets;
  push(report.opponentBib, report.opponentFish);
  return targets;
}

function duelSlotIds(state: MatchStore, match: IngestMatch, period: PeriodIndex): string[] {
  const ids: string[] = [];
  const push = (slotId: string | null | undefined) => {
    if (!slotId || ids.includes(slotId)) return;
    ids.push(slotId);
  };
  for (const report of match.reports) {
    const player = livingByBib(state, report.bibNumber);
    if (!player) continue;
    push(player.slotId);
    if (report.opponentBib !== null) push(livingByBib(state, report.opponentBib)?.slotId);
    else push(periodSeat(state.grid, state.participants, player.slotId, period)?.opponentSlotId);
  }
  return ids;
}

function livingByBib(state: MatchStore, bibNumber: number): RegisteredParticipant | undefined {
  return state.participants.find((item) => item.bibNumber === bibNumber && !item.ghost);
}

function mutualPair(state: MatchStore, slotId: string, opponentSlotId: string, period: PeriodIndex): boolean {
  const seat = periodSeat(state.grid, state.participants, slotId, period);
  const back = periodSeat(state.grid, state.participants, opponentSlotId, period);
  if (!seat || !back) return false;
  if (seat.opponentSlotId !== opponentSlotId || back.opponentSlotId !== slotId) return false;
  return !isGhostOpponent(seat.bergerOpponentSlotId) && !isGhostOpponent(back.bergerOpponentSlotId);
}

function playedFish(
  events: readonly TournamentEvent[],
  slotId: string,
  period: PeriodIndex,
): { played: boolean; fish: number } {
  const entry = tournamentCalculator.generateLeaderboard(events).find((item) => item.slotId === slotId);
  const cell = entry?.periods.find((item) => item.period === period);
  if (!cell?.played) return { played: false, fish: 0 };
  return { played: true, fish: cell.fish };
}

function buildSlotEvents(tournamentId: string, period: PeriodIndex, slotId: string, fish: number): TournamentEvent[] {
  const timestamp = Date.now();
  const catches = catchEventsForCounts(tournamentId, period, new Map([[slotId, fish]]), timestamp);
  const closed: TournamentEvent = {
    id: crypto.randomUUID(),
    tournamentId,
    type: "PERIOD_COMPLETED",
    timestamp: timestamp + catches.length,
    payload: {
      round: 1,
      period,
      protocols: [{ slotIdA: slotId, slotIdB: null, signed: true }],
    },
  };
  return [...catches, closed];
}

async function loadTournamentEvents(tournamentId: string): Promise<TournamentEvent[]> {
  const rows = await db.events.where("tournamentId").equals(tournamentId).sortBy("timestamp");
  return rows.map((row) => row.event);
}

function matchFingerprint(match: IngestMatch): string {
  const body = match.reports
    .map((report) => `${report.bibNumber}=${report.ownFish}:${report.opponentFish ?? "-"}`)
    .sort()
    .join("|");
  return `${match.status}|${body}`;
}

function fullScoreDetail(reports: readonly IngestReport[]): string | null {
  const scored = reports.filter((report) => report.opponentFish !== null);
  if (scored.length < 2) return null;
  return scored.map((report) => `№${report.bibNumber} ввёл ${report.ownFish}:${report.opponentFish}`).join(", ");
}

function scoreDetail(reports: readonly IngestReport[]): string {
  return fullScoreDetail(reports) ?? "Расхождение в счёте дуэли";
}

function conflictId(period: number, slotId: string): string {
  return `${period}:${slotId}`;
}

async function flagDuel(
  slots: readonly string[],
  period: PeriodIndex,
  fingerprint: string,
  detail: string,
): Promise<number> {
  let opened = 0;
  for (const slotId of slots) {
    const id = conflictId(period, slotId);
    const prev = await db.duelConflicts.get(id);
    if (prev?.status === "resolved" && prev.fingerprint === fingerprint) continue;
    if (prev?.status === "open" && prev.fingerprint === fingerprint && prev.detail === detail) {
      opened += 1;
      continue;
    }
    await db.duelConflicts.put({ id, period, slotId, fingerprint, status: "open", detail });
    opened += 1;
  }
  return opened;
}

async function resolveSlots(slotIds: readonly string[], period: PeriodIndex): Promise<void> {
  let changed = false;
  for (const slotId of slotIds) {
    const id = conflictId(period, slotId);
    const prev = await db.duelConflicts.get(id);
    if (!prev || prev.status === "resolved") continue;
    await db.duelConflicts.put({ ...prev, status: "resolved" });
    changed = true;
  }
  if (!changed) return;
  useMatchStore.setState({ duelConflicts: await db.duelConflicts.toArray() });
}

function currentPeriodMark(state: MatchStore): PeriodMark {
  return { period: state.period, phase: state.periodPhase };
}

function playerNamedFromEvents(events: readonly TournamentEvent[]): string[] {
  const ids: string[] = [];
  for (const event of events) {
    if (event.type !== "PARTICIPANT_REPLACED") continue;
    if (!ids.includes(event.payload.slotId)) ids.push(event.payload.slotId);
  }
  return ids;
}

function readPeriodSignal(events: readonly TournamentEvent[]): { period: PeriodIndex; phase: PeriodPhase } {
  let period: PeriodIndex = 1;
  let phase: PeriodPhase = "waiting";
  for (const event of events) {
    if (event.type !== "PERIOD_SIGNAL") continue;
    if (!isQualifyingPeriod(event.payload.period)) continue;
    period = event.payload.period;
    phase = event.payload.phase;
  }
  return { period, phase };
}

/** До кнопки «Запустить период» журнал не двигает текущий период с 1. */
function publishedPeriod(events: readonly TournamentEvent[]): {
  period: PeriodIndex;
  phase: PeriodPhase;
  officiallyStarted: boolean;
} {
  const officiallyStarted = events.some(
    (event) => event.type === "PERIOD_SIGNAL" && event.payload.phase !== "waiting",
  );
  if (!officiallyStarted) return { period: 1, phase: "waiting", officiallyStarted: false };
  return { ...readPeriodSignal(events), officiallyStarted: true };
}

async function importPlayoffGrid(
  get: () => MatchStore,
  set: (partial: Partial<MatchStore>) => void,
  payload: string,
): Promise<{ ok: true; fresh: boolean; label: string } | { ok: false; error: string }> {
  const decoded = await decodePlayoffGrid(payload);
  if (!decoded.ok) return decoded;
  const state = get();
  if (!state.tournamentOpened) return { ok: false, error: "Сначала сканируйте стартовый QR с жеребьёвкой" };
  if (state.saving || state.setupSaving || state.signalSaving) return { ok: false, error: "Журнал сейчас занят" };

  const identity = state.playoff.formed ? state.selfSlotId || state.athleteSlotId : state.athleteSlotId;
  if (!state.playoff.formed) {
    if (!identity) return { ok: false, error: "Сначала выберите свой номер и закройте 8 периодов" };
    const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
    const closed = closedQualifyingPeriods(
      rows.map((row) => row.event),
      identity,
    );
    if (!allQualifyingPeriodsClosed(closed)) {
      return { ok: false, error: "Сначала подтвердите все 8 периодов отбора" };
    }
  }

  const byBib = new Map(state.participants.map((person) => [person.bibNumber, person]));
  const seeds: PlayoffSeed[] = [];
  for (const player of [...decoded.snapshot.players].sort((left, right) => left.seed - right.seed)) {
    const local = byBib.get(player.bibNumber);
    if (!local) return { ok: false, error: `Игрока №${player.bibNumber} нет на этом телефоне. Сначала отсканируйте жеребьёвку.` };
    if (local.ghost) return { ok: false, error: `Игрок №${player.bibNumber} отмечен как не пришедший` };
    seeds.push({ slotId: local.slotId, place: player.place, seed: player.seed });
  }
  const quarterfinals = buildQuarterfinals(seeds);
  if (!quarterfinals) return { ok: false, error: "Не удалось собрать пары 1/4 из кода сетки" };

  const bibOf = (slotId: string) => state.participants.find((person) => person.slotId === slotId)?.bibNumber;
  const incomingKey = playoffSeedKey(seeds, bibOf);
  const existingKey = state.playoff.formed ? playoffSeedKey(state.playoff.seeds, bibOf) : null;
  if (state.playoff.formed && incomingKey !== null && incomingKey === existingKey) {
    focusCupMatch(get, set, seeds, identity);
    return { ok: true, fresh: false, label: "Сетка плей-офф уже на телефоне" };
  }

  const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
  const stored = rows.map((row) => row.event);
  const scored = stored.some((event) => event.type === "PLAYOFF_DUEL_SCORED" || event.type === "PLAYOFF_SIDE_REPORTED");
  if (state.playoff.formed && scored) {
    return { ok: false, error: "На телефоне уже другая сетка, в ней есть результаты" };
  }

  const timestamp = Date.now();
  const events: TournamentEvent[] = [];
  let participants = state.participants.map((person) => ({ ...person }));
  for (const player of decoded.snapshot.players) {
    const local = participants.find((person) => person.bibNumber === player.bibNumber);
    if (!local) continue;
    if (isRealAthleteName(local.displayName, local.bibNumber) || !isRealAthleteName(player.displayName, player.bibNumber)) continue;
    if (local.displayName === player.displayName) continue;
    events.push({
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PARTICIPANT_REPLACED",
      timestamp: timestamp + events.length,
      payload: { slotId: local.slotId, displayName: player.displayName },
    });
    participants = participants.map((person) =>
      person.slotId === local.slotId ? { ...person, displayName: player.displayName } : person,
    );
  }
  events.push({
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "FORM_PLAYOFF",
    timestamp: timestamp + events.length,
    payload: { seeds, quarterfinals },
  });

  set({ setupSaving: true, setupError: null, error: null });
  try {
    const previousForms = rows.filter((row) => row.event.type === "FORM_PLAYOFF").map((row) => row.id);
    await db.transaction("rw", db.events, async () => {
      if (previousForms.length > 0) await db.events.bulkDelete(previousForms);
      await db.events.bulkAdd(events.map(toRecord));
    });
    const playoff = projectPlayoff([...stored.filter((event) => event.type !== "FORM_PLAYOFF"), ...events]);
    set({
      setupSaving: false,
      participants,
      playoff,
      playoffError: null,
      playoffEntryOpen: false,
    });
    focusCupMatch(get, set, seeds, identity);
    await get().loadLeaderboard();
    await get().refreshHandoff();
    return { ok: true, fresh: false, label: "Сетка плей-офф записана" };
  } catch (error) {
    set({
      setupSaving: false,
      error: error instanceof Error ? error.message : "Не удалось записать сетку плей-офф",
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось записать сетку плей-офф",
    };
  }
}

function playoffSeedKey(
  seeds: readonly { slotId: string; place: number; seed: number }[],
  bibOf: (slotId: string) => number | undefined,
): string | null {
  const parts: string[] = [];
  for (const seed of [...seeds].sort((left, right) => left.seed - right.seed)) {
    const bib = bibOf(seed.slotId);
    if (!bib) return null;
    parts.push(`${seed.seed}:${bib}:${seed.place}`);
  }
  return parts.join(",");
}

function focusCupMatch(
  get: () => MatchStore,
  set: (partial: Partial<MatchStore>) => void,
  seeds: readonly { slotId: string }[],
  identity: string,
): void {
  const inCup = identity.length > 0 && seeds.some((seed) => seed.slotId === identity);
  if (inCup) set({ selfSlotId: identity });
  const playoff = get().playoff;
  const mine = inCup
    ? playoff.quarterfinals.find((match) => match.slotIdA === identity || match.slotIdB === identity)
    : undefined;
  const opening = mine ?? playoff.quarterfinals[0];
  if (opening) get().selectPlayoffMatch(opening.matchId);
}

async function importStartDraw(
  get: () => MatchStore,
  set: (partial: Partial<MatchStore>) => void,
  payload: string,
): Promise<{ ok: true; fresh: boolean; label: string } | { ok: false; error: string }> {
  const decoded = await decodeStartSnapshot(payload);
  if (!decoded.ok) return decoded;
  const state = get();
  if (state.saving || state.setupSaving || state.signalSaving) {
    return { ok: false, error: "Журнал сейчас занят" };
  }
  const participants = participantsFromStart(decoded.snapshot.participants);
  const grid = gridFromSeats(participants, decoded.snapshot.seats);
  if (grid.length === 0) return { ok: false, error: "В стартовом коде нет сетки" };
  const matrix = matrixFromGrid(grid, participants);
  const timestamp = Date.now();
  const events: TournamentEvent[] = participants.map((participant, index) => ({
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "PARTICIPANT_REGISTERED",
    timestamp: timestamp + index,
    payload: {
      slotId: participant.slotId,
      bibNumber: participant.bibNumber,
      displayName: participant.displayName,
      groupId: participant.groupId,
    },
  }));
  let cursor = timestamp + events.length;
  for (const participant of participants) {
    if (!participant.ghost) continue;
    events.push({
      id: crypto.randomUUID(),
      tournamentId: state.tournamentId,
      type: "PARTICIPANT_SET_GHOST",
      timestamp: cursor,
      payload: {
        slotId: participant.slotId,
        ghost: true,
        displayName: participant.displayName,
      },
    });
    cursor += 1;
  }
  events.push({
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "TOURNAMENT_OPENED",
    timestamp: cursor,
    payload: {
      rulesetId: "pal-trout-2026",
      name: decoded.snapshot.tournamentName,
      date: decoded.snapshot.tournamentDate,
      periodsPerRound: PERIODS_PER_ROUND,
      rounds: 2,
      sectorCount: decoded.snapshot.sectorCount,
    },
  });
  cursor += 1;
  events.push({
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "DRAW_SEEDED",
    timestamp: cursor,
    payload: {
      slots: participants.map((participant) => ({
        slotId: participant.slotId,
        bibNumber: participant.bibNumber,
        groupId: participant.groupId,
        displayName: participant.displayName,
        ghost: participant.ghost,
      })),
      matrix,
    },
  });
  cursor += 1;
  events.push(...loneComparisonEvents(state.tournamentId, participants, grid, cursor + 1));
  const signalAt = cursor + 1 + events.length;
  events.push({
    id: crypto.randomUUID(),
    tournamentId: state.tournamentId,
    type: "PERIOD_SIGNAL",
    timestamp: signalAt,
    payload: {
      period: decoded.snapshot.period,
      phase: decoded.snapshot.phase,
    },
  });

  set({ setupSaving: true, setupError: null, error: null });
  try {
    await db.transaction("rw", db.events, async () => {
      await db.events.clear();
      await db.events.bulkAdd(events.map(toRecord));
    });
    set({
      setupSaving: false,
      tournamentOpened: true,
      tournamentName: decoded.snapshot.tournamentName,
      tournamentDate: decoded.snapshot.tournamentDate,
      participants,
      sectorCount: decoded.snapshot.sectorCount,
      periodsCount: decoded.snapshot.periodsPerRound,
      grid,
      round: 1,
      period: decoded.snapshot.phase === "waiting" && decoded.snapshot.period === 1 ? 1 : decoded.snapshot.period,
      periodPhase: decoded.snapshot.phase,
      officiallyStarted: decoded.snapshot.phase !== "waiting" || decoded.snapshot.period > 1,
      confirmed: false,
      athleteFish: 0,
      opponentFish: 0,
      pending: [],
      savedCount: null,
      error: null,
      setupError: null,
      hydrated: true,
      leaderboard: [],
      leaderboardReady: true,
      playoff: emptyPlayoffProjection,
      eighthPeriodClosed: false,
      selectedPlayoffMatchId: "",
      playoffEntryOpen: false,
      playoffSaving: false,
      playoffError: null,
      selfSlotId: "",
      qualifyingHandoffReady: false,
      qualifyingSavedCount: 0,
      cupHandoffReady: false,
      playerNamedSlotIds: [],
      signalSaving: false,
      saving: false,
      ...emptySector,
    });
    forgetAthleteSlot();
    await get().loadLeaderboard();
    await get().refreshHandoff();
    return {
      ok: true,
      fresh: true,
      label: periodStatusLabel(decoded.snapshot.period, decoded.snapshot.phase),
    };
  } catch (error) {
    set({
      setupSaving: false,
      setupError: error instanceof Error ? error.message : "Не удалось записать жеребьёвку",
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось записать жеребьёвку",
    };
  }
}

function participantsFromStart(
  entries: readonly { bibNumber: number; displayName: string; groupId: GroupId; ghost: boolean }[],
): RegisteredParticipant[] {
  return entries
    .map((entry) => ({
      slotId: crypto.randomUUID(),
      bibNumber: entry.bibNumber,
      displayName: entry.ghost ? entry.displayName.trim() : numberedAthleteName(entry.bibNumber),
      groupId: entry.groupId,
      ghost: entry.ghost,
    }))
    .sort(byBib);
}

function gridFromSeats(participants: readonly RegisteredParticipant[], seats: readonly StartSeat[]): GridSlot[] {
  const byBib = new Map(participants.map((participant) => [participant.bibNumber, participant]));
  const slots: GridSlot[] = [];
  for (const seat of seats) {
    const left = seat.leftBib > 0 ? (byBib.get(seat.leftBib) ?? null) : null;
    const right = seat.rightBib !== null && seat.rightBib > 0 ? (byBib.get(seat.rightBib) ?? null) : null;
    if (seat.leftBib > 0 && !left) continue;
    if (seat.rightBib !== null && seat.rightBib > 0 && !right) continue;
    if (left && right) {
      slots.push(seatSlot(seat, left, right.slotId));
      slots.push(seatSlot(seat, right, left.slotId));
    } else if (left) {
      slots.push(seatSlot(seat, left, null));
    } else if (right) {
      slots.push(seatSlot(seat, right, null));
    }
  }
  return slots;
}

function seatSlot(
  seat: StartSeat,
  person: RegisteredParticipant,
  opponentSlotId: string | null,
): GridSlot {
  return {
    round: seat.round,
    period: seat.period,
    groupId: person.groupId,
    zoneId: zoneOf(person.groupId, seat.round),
    sectorId: seat.sectorId,
    slotId: person.slotId,
    bibNumber: person.bibNumber,
    side: person.bibNumber === seat.leftBib ? "left" : "right",
    opponentSlotId,
  };
}
