/**
 * PAL Trout 2026, групповая стадия.
 * Очки одного спортсмена за период — чистая функция его поимок и поимок соперника:
 *   own === 0            → 0   (0:0 и сухой проигрыш 0:3)
 *   own > opponent       → 4
 *   own === opponent > 0 → 2   (2:2, 5:5)
 *   0 < own < opponent   → 1   (в 2:4 сторона с двумя рыбами)
 * Ноль поимок всегда 0, даже если это поражение.
 */

export type RulesetId = "pal-trout-2026";

export type GroupId = "A" | "B";

export type ZoneId = "red" | "blue";

export type RoundIndex = 1 | 2;

export type PeriodIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** Отбор PAL Trout: восемь периодов, затем плей-офф топ-8. */
export const QUALIFYING_PERIOD_COUNT = 8 as const;

export const QUALIFYING_PERIODS: readonly PeriodIndex[] = [1, 2, 3, 4, 5, 6, 7, 8];

export const PLAYOFF_FIELD = 8 as const;

export type Side = "left" | "right";

/** 4 победа, 2 ничья с рыбой, 1 поражение с рыбой, 0 ноль поимок. */
export type PeriodPoints = 0 | 1 | 2 | 4;

/** Неотрицательное целое число поимок за период. */
export type FishCount = number;

export type FishDelta = 1 | -1;

export type CardColor = "yellow" | "red";

/**
 * Берег группы на игровой день.
 * А: день 1 синий, день 2 красный. Б: наоборот.
 */
export interface PalZoneAssignment {
  readonly A: { readonly 1: "blue"; readonly 2: "red" };
  readonly B: { readonly 1: "red"; readonly 2: "blue" };
}

/**
 * Порядок тай-брейка, п. 4.4.
 * headToHead пропускается, если личной встречи не было.
 * catchRatio = свои поимки / поимки соперников; если делитель 0,
 * выше тот, у кого свои поимки больше нуля.
 */
export type TieBreakCriterion =
  | "points"
  | "headToHead"
  | "catchRatio"
  | "totalFish"
  | "lastRoundFish";

export interface TournamentEventBase {
  id: string;
  tournamentId: string;
  /** Unix ms. В расчёт очков не входит, только порядок свёртки. */
  timestamp: number;
}

export interface TournamentOpenedEvent extends TournamentEventBase {
  type: "TOURNAMENT_OPENED";
  payload: {
    rulesetId: RulesetId;
    name: string;
    /** День проведения, ISO `YYYY-MM-DD`. Пусто у турниров, открытых до этого поля. */
    date?: string;
    periodsPerRound: typeof QUALIFYING_PERIOD_COUNT;
    rounds: 2;
    /** Сколько секторов на водоёме зафиксировано при открытии. */
    sectorCount: number;
  };
}

/** Игрок внесён в стартовый лист. Номер жеребьёвки после этого не меняется. */
export interface ParticipantRegisteredEvent extends TournamentEventBase {
  type: "PARTICIPANT_REGISTERED";
  payload: {
    slotId: string;
    bibNumber: number;
    displayName: string;
    groupId: GroupId;
  };
}

export interface SeededSlot {
  slotId: string;
  /** Порядковый номер жеребьёвки. После посева не меняется. */
  bibNumber: number;
  groupId: GroupId;
  displayName: string;
  /** Не пришёл на старт. Слот и номер жеребьёвки сохраняются. */
  ghost?: boolean;
}

export type MatrixDuelBase = {
  round: RoundIndex;
  period: PeriodIndex;
  groupId: GroupId;
  zoneId: ZoneId;
  sectorId: string;
};

/** Пара из загруженной матрицы. Слева — левый борт сектора. */
export interface MatrixPair extends MatrixDuelBase {
  kind: "pair";
  leftSlotId: string;
  rightSlotId: string;
}

/** Сектор без соперника. Сосед в матрицу не записывается. */
export interface MatrixLone extends MatrixDuelBase {
  kind: "lone";
  loneSlotId: string;
}

export type MatrixDuel = MatrixPair | MatrixLone;

export interface DrawSeededEvent extends TournamentEventBase {
  type: "DRAW_SEEDED";
  payload: {
    slots: readonly SeededSlot[];
    matrix: readonly MatrixDuel[];
  };
}

export type ManualDuelBase = {
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string | null;
};

/** Судья внёс готовую пару без карты переходов. */
export interface ManualPair extends ManualDuelBase {
  kind: "pair";
  slotIdA: string;
  slotIdB: string;
}

/** Судья внёс одиночку и сам указал соседа. */
export interface ManualLone extends ManualDuelBase {
  kind: "lone";
  loneSlotId: string;
  neighborSlotId: string;
}

export type ManualDuel = ManualPair | ManualLone;

export interface DuelAssignedEvent extends TournamentEventBase {
  type: "DUEL_ASSIGNED";
  payload: ManualDuel;
}

/**
 * Зафиксированный сосед одиночки.
 * Если события нет, очки всё равно считаются: сосед — ближайший по сектору в этом периоде.
 * Очки виртуальной дуэли получает только одиночка.
 */
export interface LoneComparedEvent extends TournamentEventBase {
  type: "LONE_COMPARED";
  payload: {
    round: RoundIndex;
    period: PeriodIndex;
    loneSlotId: string;
    neighborSlotId: string;
    source: LoneNeighborInput["mode"];
  };
}

/** Меняется только имя. slotId и номер остаются. Фантом при этом снимается. */
export interface ParticipantReplacedEvent extends TournamentEventBase {
  type: "PARTICIPANT_REPLACED";
  payload: {
    slotId: string;
    displayName: string;
  };
}

/**
 * Участник не пришёл. Слот остаётся в жеребьёвке.
 * Имя на стартовом листе становится «ФАНТОМ N», номер не меняется.
 */
export interface ParticipantSetGhostEvent extends TournamentEventBase {
  type: "PARTICIPANT_SET_GHOST";
  payload: {
    slotId: string;
    ghost: true;
    displayName: string;
  };
}

/** Участник снят со стартового листа до открытия турнира. Слот в жеребьёвку не попадает. */
export interface ParticipantRemovedEvent extends TournamentEventBase {
  type: "PARTICIPANT_REMOVED";
  payload: {
    slotId: string;
  };
}

export interface CatchRecordedEvent extends TournamentEventBase {
  type: "CATCH_RECORDED";
  payload: {
    slotId: string;
    round: RoundIndex;
    period: PeriodIndex;
    delta: FishDelta;
  };
}

/** Переход на вторую 10-минутку. На очки не влияет. */
export interface TransitionDecidedEvent extends TournamentEventBase {
  type: "TRANSITION_DECIDED";
  payload: {
    round: RoundIndex;
    period: PeriodIndex;
    sectorId: string;
    requested: boolean;
    requestedBySlotId: string | null;
  };
}

/**
 * Жёлтая карточка обнуляет рыбу и очки спортсмена за этот период.
 * Красная обнуляет рыбу и очки за весь тур дня.
 */
export interface CardIssuedEvent extends TournamentEventBase {
  type: "CARD_ISSUED";
  payload: {
    slotId: string;
    round: RoundIndex;
    period: PeriodIndex;
    card: CardColor;
  };
}

/**
 * Закрытие периода.
 * Пара с signed: false фиксируется как 0:0, поимки этой пары в очки не идут.
 */
export interface PeriodCompletedEvent extends TournamentEventBase {
  type: "PERIOD_COMPLETED";
  payload: {
    round: RoundIndex;
    period: PeriodIndex;
    protocols: readonly ProtocolSignature[];
  };
}

/** Сирена на водоёме. На очки не влияет: телефоны сверяют по ней период, а не по своим часам. */
export type PeriodPhase = "waiting" | "fishing" | "closed";

export interface PeriodSignalEvent extends TournamentEventBase {
  type: "PERIOD_SIGNAL";
  payload: {
    period: PeriodIndex;
    phase: PeriodPhase;
  };
}

export type PlayoffStage = "quarterfinal" | "semifinal" | "final";

/** Место отбора. seed 1 — первый в таблице, даже если place совпал с соседом. */
export interface PlayoffSeed {
  slotId: string;
  place: number;
  seed: number;
}

/** Четвертьфинал, записанный в FORM_PLAYOFF. Меньший seed стоит на стороне A. */
export interface PlayoffPairing {
  matchId: string;
  stage: "quarterfinal";
  order: number;
  slotIdA: string;
  slotIdB: string;
  seedA: number;
  seedB: number;
  placeA: number;
  placeB: number;
}

/**
 * Сетка топ-8 после восьмого периода.
 * Пары: 1–8, 2–7, 3–6, 4–5.
 */
export interface PlayoffFormedEvent extends TournamentEventBase {
  type: "FORM_PLAYOFF";
  payload: {
    seeds: readonly PlayoffSeed[];
    quarterfinals: readonly PlayoffPairing[];
  };
}

/** Поимки одной кубковой пары. Победитель считается заново, в событии его нет. */
export interface PlayoffDuelScoredEvent extends TournamentEventBase {
  type: "PLAYOFF_DUEL_SCORED";
  payload: {
    matchId: string;
    slotIdA: string;
    slotIdB: string;
    fishA: FishCount;
    fishB: FishCount;
  };
}

/** Поимки одной стороны пары, пришедшие отдельно (QR). Победителя ещё нет. */
export interface PlayoffSideReportedEvent extends TournamentEventBase {
  type: "PLAYOFF_SIDE_REPORTED";
  payload: {
    matchId: string;
    slotId: string;
    fish: FishCount;
  };
}

export type PlayoffTieBreak = "catches" | "qualifyingPlace";

/** Ничья по поимкам невозможна: при равенстве побеждает более высокое место отбора. */
export interface PlayoffDecision {
  winner: "a" | "b";
  fishA: FishCount;
  fishB: FishCount;
  decidedBy: PlayoffTieBreak;
}

export interface PlayoffBracketMatch {
  matchId: string;
  stage: PlayoffStage;
  order: number;
  slotIdA: string | null;
  slotIdB: string | null;
  seedA: number | null;
  seedB: number | null;
  placeA: number | null;
  placeB: number | null;
  fishA: number | null;
  fishB: number | null;
  winnerSlotId: string | null;
  decidedBy: PlayoffTieBreak | null;
}

export interface PlayoffProjection {
  formed: boolean;
  seeds: readonly PlayoffSeed[];
  quarterfinals: readonly PlayoffBracketMatch[];
  semifinals: readonly PlayoffBracketMatch[];
  final: PlayoffBracketMatch | null;
}

export interface ProtocolSignature {
  slotIdA: string;
  slotIdB: string | null;
  signed: boolean;
}

export type TournamentEvent =
  | TournamentOpenedEvent
  | ParticipantRegisteredEvent
  | DrawSeededEvent
  | DuelAssignedEvent
  | LoneComparedEvent
  | ParticipantReplacedEvent
  | ParticipantSetGhostEvent
  | ParticipantRemovedEvent
  | CatchRecordedEvent
  | TransitionDecidedEvent
  | CardIssuedEvent
  | PeriodCompletedEvent
  | PeriodSignalEvent
  | PlayoffFormedEvent
  | PlayoffDuelScoredEvent
  | PlayoffSideReportedEvent;

/** isSynced живёт только на устройстве и в доменную свёртку не входит. */
export interface LocalEventRecord {
  event: TournamentEvent;
  isSynced: boolean;
}

export interface SectorSlot {
  sectorId: string;
  /** Порядок секторов слева направо. */
  order: number;
  zoneId: ZoneId;
  round: RoundIndex;
  period: PeriodIndex;
  slotIds: readonly [string] | readonly [string, string];
}

/** Как выбрать соседа. Реализация resolve подставляется снаружи. */
export type NeighborResolver = (loneId: string, sectors: readonly SectorSlot[]) => string;

export type LoneNeighborInput =
  | { mode: "manual"; neighborId: string }
  | { mode: "sectors"; sectors: readonly SectorSlot[]; resolve: NeighborResolver };

/**
 * Законный исход одной дуэли.
 * blank — только 0:0.
 * draw — равный положительный счёт, обеим сторонам по 2.
 * win — победителю 4; проигравшему 1, если у него есть рыба, иначе 0.
 */
export type DuelPoints =
  | {
      outcome: "blank";
      a: { fish: 0; points: 0 };
      b: { fish: 0; points: 0 };
    }
  | {
      outcome: "draw";
      /** Одинаковое число поимок, не меньше 1. */
      fish: FishCount;
      a: { points: 2 };
      b: { points: 2 };
    }
  | {
      outcome: "win";
      winner: "a" | "b";
      winnerFish: FishCount;
      loserFish: FishCount;
      winnerPoints: 4;
      loserPoints: 0 | 1;
    };

export interface ScoredAthlete {
  slotId: string;
  bibNumber: number;
  fish: FishCount;
  points: PeriodPoints;
}

export interface PairDuelResult {
  kind: "pair";
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string | null;
  source: "matrix" | "manual";
  a: ScoredAthlete;
  b: ScoredAthlete;
  points: DuelPoints;
}

/**
 * Очки comparison получает только одиночка.
 * Сосед в эту дуэль свои турнирные очки не добавляет.
 */
export interface LoneDuelResult {
  kind: "lone";
  round: RoundIndex;
  period: PeriodIndex;
  sectorId: string | null;
  source: "matrix" | "manual";
  lone: ScoredAthlete;
  neighborId: string;
  neighborFish: FishCount;
  awardedToNeighbor: false;
  /** П. 4.5.2: соседу-ориентиру переход после первой половины запрещён. */
  neighborTransitionViolation: boolean;
}

export type DuelResult = PairDuelResult | LoneDuelResult;

export interface VirtualDuelResult {
  loneId: string;
  neighborId: string;
  loneFish: FishCount;
  neighborFish: FishCount;
  lonePoints: PeriodPoints;
  comparison: DuelPoints;
  awardedToNeighbor: false;
  neighborTransitionViolation: boolean;
}

/** Место спортсмена в матрице переходов: период, сектор, сторона и соперник. */
export interface GridSlot {
  round: RoundIndex;
  period: PeriodIndex;
  groupId: GroupId;
  zoneId: ZoneId;
  sectorId: string;
  slotId: string;
  bibNumber: number;
  side: Side;
  opponentSlotId: string | null;
}

/** Ячейка одного периода в таблице. played: false — период ещё не сыгран. */
export interface PeriodResult {
  period: PeriodIndex;
  played: boolean;
  points: PeriodPoints;
  /** Свои поимки. */
  fish: FishCount;
  /** Поимки соперника в этой дуэли. У несыгранного периода 0. */
  opponentFish: FishCount;
}

export interface LeaderboardEntry {
  place: number;
  slotId: string;
  bibNumber: number;
  groupId: GroupId;
  displayName: string;
  points: number;
  fishCount: FishCount;
  /** Сумма поимок соперников. Ноль — особый случай catchRatio. */
  opponentFishCount: FishCount;
  lastRoundFish: FishCount;
  /** Восемь ячеек первого тура, по периодам 1–8. */
  periods: readonly PeriodResult[];
}

export interface TournamentCalculator {
  /** Очки одной пары. Карта переходов не нужна. */
  scoreDuel(fishA: FishCount, fishB: FishCount): DuelPoints;

  /** Дуэли из матрицы и ручных пар. Одиночка сравнивается с ближайшим соседом по сектору. */
  calculateDuels(events: readonly TournamentEvent[]): DuelResult[];

  /** Сквозная таблица. Сортировка по TieBreakCriterion. */
  generateLeaderboard(events: readonly TournamentEvent[]): LeaderboardEntry[];

  /** Читает матрицу. Пары не выдумывает. */
  readTransitionGrid(events: readonly TournamentEvent[]): GridSlot[];

  /**
   * Кубковая дуэль. При равных поимках побеждает более высокое место отбора.
   * Ничьи нет: при одном месте решает меньший seed.
   */
  scorePlayoffDuel(
    fishA: FishCount,
    fishB: FishCount,
    placeA: number,
    seedA: number,
    placeB: number,
    seedB: number,
  ): PlayoffDecision;

  /** Четвертьфинал из FORM_PLAYOFF, полуфинал и финал — из победителей. */
  projectPlayoff(events: readonly TournamentEvent[]): PlayoffProjection;

  /**
   * Виртуальный результат одиночки.
   * mode "manual" — neighborId передан судьёй.
   * mode "sectors" — id соседа возвращает resolve, очки те же.
   */
  calculateLoneResult(
    events: readonly TournamentEvent[],
    loneId: string,
    neighbor: LoneNeighborInput,
  ): VirtualDuelResult;
}
