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

class TournamentDatabase extends Dexie {
  events!: Table<EventRecord, string>;

  constructor() {
    super("FishingTournamentPortal");
    this.version(1).stores({
      events: "id, tournamentId, type, timestamp, isSynced",
    });
  }
}

export const db = new TournamentDatabase();
