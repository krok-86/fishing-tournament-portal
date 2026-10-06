import Dexie from "dexie";
class TournamentDatabase extends Dexie {
    events;
    constructor() {
        super("FishingTournamentPortal");
        this.version(1).stores({
            events: "id, tournamentId, type, timestamp, isSynced",
        });
    }
}
export const db = new TournamentDatabase();
