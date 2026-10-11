import Dexie from "dexie";
class TournamentDatabase extends Dexie {
    events;
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
    }
}
export const db = new TournamentDatabase();
