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
declare class TournamentDatabase extends Dexie {
    events: Table<EventRecord, string>;
    constructor();
}
export declare const db: TournamentDatabase;
export {};
