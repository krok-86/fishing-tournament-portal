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
declare class TournamentDatabase extends Dexie {
    events: Table<EventRecord, string>;
    outboxQueue: Table<OutboxItem, string>;
    duelConflicts: Table<DuelConflictRecord, string>;
    constructor();
}
export declare const db: TournamentDatabase;
export {};
