import Dexie, { type Table } from "dexie";
import type { TournamentEvent } from "../../../packages/shared/src/types.ts";

/** Локальная запись лога. isSynced не входит в доменное событие. */
export interface EventRecord {
  id: string;
  tournamentId: string;
  type: TournamentEvent["type"];
  timestamp: number;
  isSynced: boolean;
  event: TournamentEvent;
}

/** Пакет улова, который ещё не принял сервер. Телефон шлёт его снова, когда появляется сеть. */
export interface OutboxItem {
  id: string;
  createdAt: number;
  bibNumber: number;
  opponentBib: number | null;
  period: number;
  ownFish: number;
  opponentFish: number;
}

/** Расхождение дуэли на ноутбуке организатора. Решение орга снимает подсветку. */
export interface DuelConflictRecord {
  id: string;
  period: number;
  slotId: string;
  fingerprint: string;
  status: "open" | "resolved";
  detail: string;
}

class TournamentDatabase extends Dexie {
  events!: Table<EventRecord, string>;
  outboxQueue!: Table<OutboxItem, string>;
  duelConflicts!: Table<DuelConflictRecord, string>;

  constructor() {
    super("FishingTournamentPortal");
    this.version(1).stores({
      events: "id, tournamentId, type, timestamp, isSynced",
    });
    // Старая жеребьёвка ломала борта и повторяла пары. Журнал с той сеткой больше не годится.
    this.version(2)
      .stores({
        events: "id, tournamentId, type, timestamp, isSynced",
      })
      .upgrade((tx) => tx.table("events").clear());
    // Круг Бергера и борты по чётности. Старая матрица в журнале больше не совпадает с сеткой.
    this.version(3)
      .stores({
        events: "id, tournamentId, type, timestamp, isSynced",
      })
      .upgrade((tx) => tx.table("events").clear());
    // Период 1: нечётные слева, дальше каждый чередует свой борт и сектор. Старая сетка больше не годится.
    this.version(4)
      .stores({
        events: "id, tournamentId, type, timestamp, isSynced",
      })
      .upgrade((tx) => tx.table("events").clear());
    // Период 1 перемешан, дальше любые пары. Старая матрица больше не совпадает.
    this.version(5)
      .stores({
        events: "id, tournamentId, type, timestamp, isSynced",
      })
      .upgrade((tx) => tx.table("events").clear());
    // Очередь отправки и споры дуэлей. Журнал турнира не трогаем.
    this.version(6).stores({
      events: "id, tournamentId, type, timestamp, isSynced",
      outboxQueue: "id, createdAt",
      duelConflicts: "id, period, slotId, status",
    });
  }
}

export const db = new TournamentDatabase();
