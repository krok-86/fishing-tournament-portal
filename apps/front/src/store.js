import { create } from "zustand";
import { buildQuarterfinals, emptyPlayoffProjection, generateTournamentGrid, playoffMatches, projectPlayoff, seedsFromRanking, tournamentCalculator, withPlayoffDuel, withPlayoffReport, } from "../../../packages/shared/src/calculator.ts";
import { QUALIFYING_PERIOD_COUNT, QUALIFYING_PERIODS, } from "../../../packages/shared/src/types.ts";
import { db } from "./db.ts";
import { decodeCatchSnapshot, encodeCatchSnapshot, encodePlayoffSnapshot, expandCatchEvents, playoffMatchId, playoffStageCode, snapshotFromEvents, totalFish, } from "./qrSync.ts";
const PERIOD_SECONDS = 20 * 60;
const PERIODS_PER_ROUND = QUALIFYING_PERIOD_COUNT;
const TOURNAMENT_NAME = "Локальный турнир";
const emptySector = {
    sectorLabel: "—",
    sideLabel: "СЛЕВА",
    athleteSlotId: "",
    opponentSlotId: "",
    athleteName: "Вы",
    opponentName: "Соперник",
    briefing: "",
};
export const useMatchStore = create((set, get) => ({
    tournamentId: "local-session",
    ...emptySector,
    round: 1,
    period: 1,
    athleteFish: 0,
    opponentFish: 0,
    secondsLeft: PERIOD_SECONDS,
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
    tournamentOpened: false,
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
    adjustFish(who, delta) {
        const state = get();
        if (!state.tournamentOpened || state.saving)
            return;
        if (state.playoff.formed) {
            if (!state.selectedPlayoffMatchId)
                return;
            const countKey = who === "athlete" ? "athleteFish" : "opponentFish";
            const nextCount = state[countKey] + delta;
            if (nextCount < 0)
                return;
            set({
                [countKey]: nextCount,
                pending: [],
                confirmed: false,
                savedCount: null,
                error: null,
            });
            return;
        }
        if (state.confirmed)
            return;
        const countKey = who === "athlete" ? "athleteFish" : "opponentFish";
        const slotId = who === "athlete" ? state.athleteSlotId : state.opponentSlotId;
        if (!slotId)
            return;
        const nextCount = state[countKey] + delta;
        if (nextCount < 0)
            return;
        set({
            [countKey]: nextCount,
            pending: [...state.pending, { slotId, delta }],
            savedCount: null,
            error: null,
        });
    },
    tick() {
        const { secondsLeft, confirmed, tournamentOpened } = get();
        if (!tournamentOpened || confirmed || secondsLeft <= 0)
            return;
        set({ secondsLeft: secondsLeft - 1 });
    },
    setPeriod(period) {
        const state = get();
        if (!state.tournamentOpened || state.saving || state.playoff.formed)
            return;
        if (!isQualifyingPeriod(period) || period === state.period)
            return;
        const selected = state.athleteSlotId;
        set({
            period,
            ...emptySector,
            athleteFish: 0,
            opponentFish: 0,
            pending: [],
            confirmed: false,
            savedCount: null,
            error: null,
            secondsLeft: PERIOD_SECONDS,
        });
        if (selected)
            get().selectAthlete(selected);
    },
    async confirmPeriod() {
        const state = get();
        if (state.playoff.formed) {
            await savePlayoffDuel(get, set);
            return;
        }
        if (!state.tournamentOpened || state.confirmed || state.saving || !state.athleteSlotId)
            return;
        set({ saving: true, error: null });
        const timestamp = Date.now();
        const slotIds = [state.athleteSlotId, state.opponentSlotId].filter((slotId) => slotId.length > 0);
        const events = absoluteCatches(state, slotIds, timestamp);
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
            set({
                saving: false,
                confirmed: true,
                pending: [],
                savedCount: events.length,
            });
            await get().loadLeaderboard();
        }
        catch (error) {
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
        }
        catch (error) {
            set({
                leaderboardReady: true,
                error: error instanceof Error ? error.message : "Не удалось посчитать таблицу",
            });
            return [];
        }
    },
    async hydrate() {
        const tournamentId = get().tournamentId;
        try {
            const rows = await db.events.where("tournamentId").equals(tournamentId).sortBy("timestamp");
            const stored = rows.map((row) => row.event);
            const snapshot = readSetup(stored);
            const grid = snapshot.tournamentOpened ? gridOf(snapshot.participants, snapshot.periodsPerRound) : [];
            const playoff = projectPlayoff(stored);
            set({
                participants: snapshot.participants,
                grid,
                tournamentOpened: snapshot.tournamentOpened,
                sectorCount: snapshot.tournamentOpened
                    ? snapshot.sectorCount
                    : requiredSectorCount(snapshot.participants.length),
                hydrated: true,
                setupError: null,
                ...emptySector,
                ...cupPatch(stored, snapshot.participants, grid),
                selectedPlayoffMatchId: "",
                playoffEntryOpen: false,
            });
            const opening = playoffMatches(playoff).find((match) => match.slotIdA && match.slotIdB && !match.winnerSlotId)
                ?? playoffMatches(playoff).find((match) => match.slotIdA && match.slotIdB);
            if (opening)
                get().selectPlayoffMatch(opening.matchId);
        }
        catch (error) {
            set({
                hydrated: true,
                setupError: error instanceof Error ? error.message : "Не удалось прочитать журнал турнира",
            });
        }
    },
    async registerParticipant(displayName) {
        const name = displayName.trim();
        const state = get();
        if (!name || state.tournamentOpened || state.setupSaving)
            return false;
        const bibNumber = state.participants.reduce((max, participant) => Math.max(max, participant.bibNumber), 0) + 1;
        const participant = {
            slotId: crypto.randomUUID(),
            bibNumber,
            displayName: name,
            groupId: "A",
            ghost: false,
        };
        const event = {
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
        const nextParticipants = [...previous, participant];
        set({
            participants: nextParticipants,
            sectorCount: requiredSectorCount(nextParticipants.length),
            setupSaving: true,
            setupError: null,
        });
        try {
            await db.events.add(toRecord(event));
            set({ setupSaving: false });
            return true;
        }
        catch (error) {
            set({
                setupSaving: false,
                participants: previous,
                sectorCount: requiredSectorCount(previous.length),
                setupError: error instanceof Error ? error.message : "Не удалось записать участника",
            });
            return false;
        }
    },
    async seedNumberedStart(count) {
        const state = get();
        if (state.tournamentOpened || state.setupSaving)
            return false;
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
        if (state.tournamentOpened || state.setupSaving)
            return false;
        const parsed = parseRegistrationBatch(value);
        if (!parsed.ok) {
            set({ setupError: parsed.error });
            return false;
        }
        return appendRegisteredParticipants(set, state, parsed.batch.participants);
    },
    async replaceParticipant(slotId, displayName) {
        const name = displayName.trim();
        const state = get();
        if (!name || state.setupSaving)
            return false;
        const current = state.participants.find((participant) => participant.slotId === slotId);
        if (!current || current.displayName === name)
            return false;
        if (state.tournamentOpened && current.ghost)
            return false;
        const event = {
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
            displayName: name,
            ghost: state.tournamentOpened ? current.ghost : false,
        };
        const saved = await commitParticipantUpdate(set, state.participants, slotId, nextParticipant, event, {
            optimistic: renamedLabels(state, current.bibNumber, slotId, name),
            rollback: { athleteName: state.athleteName, opponentName: state.opponentName, briefing: state.briefing },
        });
        if (saved && get().tournamentOpened) {
            const selected = get().athleteSlotId;
            if (selected)
                get().selectAthlete(selected);
            await get().loadLeaderboard();
        }
        return saved;
    },
    async setParticipantGhost(slotId) {
        const state = get();
        if (state.tournamentOpened || state.setupSaving)
            return false;
        const current = state.participants.find((participant) => participant.slotId === slotId);
        if (!current || current.ghost)
            return false;
        const displayName = phantomName(current.bibNumber);
        const event = {
            id: crypto.randomUUID(),
            tournamentId: state.tournamentId,
            type: "PARTICIPANT_SET_GHOST",
            timestamp: Date.now(),
            payload: {
                slotId,
                ghost: true,
                displayName,
            },
        };
        return commitParticipantUpdate(set, state.participants, slotId, { ...current, displayName, ghost: true }, event);
    },
    async removeParticipant(slotId) {
        const state = get();
        if (state.tournamentOpened || state.setupSaving)
            return false;
        if (!state.participants.some((participant) => participant.slotId === slotId))
            return false;
        return dropParticipants(set, state, [slotId]);
    },
    async resetTournament() {
        if (get().setupSaving)
            return false;
        set({ setupSaving: true, setupError: null });
        try {
            await db.events.clear();
            set({
                ...emptySector,
                round: 1,
                period: 1,
                athleteFish: 0,
                opponentFish: 0,
                secondsLeft: PERIOD_SECONDS,
                pending: [],
                confirmed: false,
                saving: false,
                savedCount: null,
                error: null,
                leaderboard: [],
                leaderboardReady: true,
                participants: [],
                grid: [],
                sectorCount: 0,
                tournamentOpened: false,
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
            });
            return true;
        }
        catch (error) {
            set({
                setupSaving: false,
                setupError: error instanceof Error ? error.message : "Не удалось сбросить турнир",
            });
            return false;
        }
    },
    async clearParticipants() {
        const state = get();
        if (state.tournamentOpened || state.setupSaving)
            return false;
        if (state.participants.length === 0)
            return false;
        return dropParticipants(set, state, state.participants.map((participant) => participant.slotId));
    },
    async startTournament() {
        const state = get();
        if (state.tournamentOpened || state.setupSaving)
            return state.tournamentOpened;
        if (state.participants.length < 2) {
            set({ setupError: "Добавьте хотя бы двух участников" });
            return false;
        }
        const ordered = [...state.participants].sort(byBib);
        const sectorCount = requiredSectorCount(ordered.length);
        const grid = gridOf(ordered, PERIODS_PER_ROUND);
        const matrix = matrixFromGrid(grid, ordered);
        const timestamp = Date.now();
        const comparisons = loneComparisonEvents(state.tournamentId, ordered, grid, timestamp + 2);
        const opened = {
            id: crypto.randomUUID(),
            tournamentId: state.tournamentId,
            type: "TOURNAMENT_OPENED",
            timestamp,
            payload: {
                rulesetId: "pal-trout-2026",
                name: TOURNAMENT_NAME,
                periodsPerRound: PERIODS_PER_ROUND,
                rounds: 2,
                sectorCount,
            },
        };
        const draw = {
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
                set({
                    setupSaving: false,
                    tournamentOpened: true,
                    participants: snapshot.participants,
                    sectorCount: snapshot.sectorCount,
                    grid: openedGrid,
                    ...emptySector,
                    ...cupPatch(stored, snapshot.participants, openedGrid),
                });
                return true;
            }
            await db.events.bulkAdd([toRecord(opened), toRecord(draw), ...comparisons.map(toRecord)]);
            set({
                setupSaving: false,
                tournamentOpened: true,
                sectorCount,
                grid,
                round: 1,
                period: 1,
                secondsLeft: PERIOD_SECONDS,
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
        }
        catch (error) {
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
        if (state.playoffSaving)
            return false;
        if (state.playoff.formed)
            return true;
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
                if (first)
                    get().selectPlayoffMatch(first.matchId);
                return true;
            }
            const fishing = new Set(state.participants.filter((participant) => !participant.ghost).map((participant) => participant.slotId));
            const ranked = tournamentCalculator.generateLeaderboard(stored).filter((entry) => fishing.has(entry.slotId));
            const seeds = seedsFromRanking(ranked);
            const quarterfinals = seeds ? buildQuarterfinals(seeds) : null;
            if (!seeds || !quarterfinals) {
                set({ playoffSaving: false, playoffError: "Для плей-офф нужны 8 спортсменов в таблице" });
                return false;
            }
            const event = {
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
            if (first)
                get().selectPlayoffMatch(first.matchId);
            await get().loadLeaderboard();
            return true;
        }
        catch (error) {
            set({
                playoffSaving: false,
                playoffError: error instanceof Error ? error.message : "Не удалось сформировать плей-офф",
            });
            return false;
        }
    },
    selectPlayoffMatch(matchId) {
        const state = get();
        if (!state.playoff.formed || state.saving)
            return;
        const match = playoffMatches(state.playoff).find((item) => item.matchId === matchId);
        if (!match?.slotIdA || !match.slotIdB)
            return;
        const scored = match.fishA !== null && match.fishB !== null && match.winnerSlotId !== null;
        set({
            ...viewFromPlayoff(state.participants, match),
            selectedPlayoffMatchId: matchId,
            athleteFish: scored ? match.fishA ?? 0 : 0,
            opponentFish: scored ? match.fishB ?? 0 : 0,
            pending: [],
            confirmed: scored,
            savedCount: null,
            error: null,
            secondsLeft: PERIOD_SECONDS,
        });
    },
    openPlayoffEntry(matchId) {
        const state = get();
        if (!state.playoff.formed || state.saving)
            return;
        get().selectPlayoffMatch(matchId);
        if (get().selectedPlayoffMatchId !== matchId)
            return;
        set({ playoffEntryOpen: true });
    },
    closePlayoffEntry() {
        if (get().saving)
            return;
        const matchId = get().selectedPlayoffMatchId;
        set({ playoffEntryOpen: false });
        if (matchId)
            get().selectPlayoffMatch(matchId);
    },
    selectAthlete(slotId) {
        const state = get();
        if (!state.tournamentOpened || state.saving)
            return;
        if (state.playoff.formed) {
            if (!slotId) {
                set({ selfSlotId: "" });
                return;
            }
            const playing = state.participants.find((item) => item.slotId === slotId);
            if (!playing || playing.ghost)
                return;
            set({ selfSlotId: slotId, error: null });
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
            return;
        }
        const participant = state.participants.find((item) => item.slotId === slotId);
        if (!participant || participant.ghost)
            return;
        const slot = state.grid.find((item) => item.slotId === slotId && item.round === state.round && item.period === state.period);
        if (!slot) {
            set({ ...emptySector, error: "В этом периоде для номера нет сектора" });
            return;
        }
        const sameAthlete = state.athleteSlotId === slotId;
        set({
            ...viewFromGrid(state.participants, state.grid, slot),
            selfSlotId: slotId,
            error: null,
            ...(sameAthlete
                ? {}
                : {
                    athleteFish: 0,
                    opponentFish: 0,
                    pending: [],
                    confirmed: false,
                    savedCount: null,
                }),
        });
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
                if (playoffCells.length === 0)
                    return { ok: false, error: "Нет несинхронизированных поимок" };
                return {
                    ok: true,
                    packet: {
                        payload: encodePlayoffSnapshot(participant.bibNumber, playoffCells),
                        bibNumber: participant.bibNumber,
                        displayName: participant.displayName,
                        fish: totalFish(playoffCells),
                        periods: playoffCells.length,
                        cells: [],
                        playoffCells,
                    },
                };
            }
            const live = !state.confirmed && state.pending.some((item) => item.slotId === slotId)
                ? { round: state.round, period: state.period, fish: state.athleteFish }
                : null;
            const cells = snapshotFromEvents(rows, slotId, live);
            if (cells.length === 0)
                return { ok: false, error: "Нет несинхронизированных поимок" };
            return {
                ok: true,
                packet: {
                    payload: encodeCatchSnapshot(participant.bibNumber, cells),
                    bibNumber: participant.bibNumber,
                    displayName: participant.displayName,
                    fish: totalFish(cells),
                    periods: cells.length,
                    cells,
                    playoffCells: [],
                },
            };
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Не удалось собрать результаты",
            };
        }
    },
    async importAthleteResults(payload) {
        const decoded = decodeCatchSnapshot(payload);
        if (!decoded.ok)
            return decoded;
        const state = get();
        if (!state.tournamentOpened)
            return { ok: false, error: "Сначала откройте турнир" };
        const participant = state.participants.find((item) => item.bibNumber === decoded.bibNumber);
        if (!participant)
            return { ok: false, error: `Игрок №${decoded.bibNumber} не найден в этом турнире` };
        if (participant.ghost)
            return { ok: false, error: `Игрок №${decoded.bibNumber} отмечен как не пришедший` };
        if (decoded.mode === "playoff") {
            return importPlayoffSnapshot(get, set, participant, decoded.cells);
        }
        const covered = new Set(decoded.cells.map((cell) => periodKey(cell)));
        const events = expandCatchEvents(state.tournamentId, participant.slotId, decoded.cells, Date.now());
        try {
            await db.transaction("rw", db.events, async () => {
                const rows = await db.events.where("tournamentId").equals(state.tournamentId).toArray();
                const staleIds = rows.flatMap((row) => {
                    const event = row.event;
                    if (event.type !== "CATCH_RECORDED")
                        return [];
                    if (event.payload.slotId !== participant.slotId)
                        return [];
                    if (!covered.has(periodKey(event.payload)))
                        return [];
                    return [row.id];
                });
                if (staleIds.length > 0)
                    await db.events.bulkDelete(staleIds);
                if (events.length > 0)
                    await db.events.bulkAdd(events.map(toSyncedRecord));
            });
            await get().loadLeaderboard();
            return {
                ok: true,
                packet: {
                    bibNumber: participant.bibNumber,
                    displayName: participant.displayName,
                    fish: totalFish(decoded.cells),
                    periods: decoded.cells.length,
                },
            };
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Не удалось записать результаты",
            };
        }
    },
}));
function readSetup(events) {
    const participants = [];
    let tournamentOpened = false;
    let sectorCount = 0;
    let periodsPerRound = PERIODS_PER_ROUND;
    let matrix = [];
    for (const event of events) {
        if (event.type === "PARTICIPANT_REGISTERED") {
            participants.push({
                slotId: event.payload.slotId,
                bibNumber: event.payload.bibNumber,
                displayName: event.payload.displayName,
                groupId: event.payload.groupId,
                ghost: false,
            });
        }
        else if (event.type === "PARTICIPANT_REPLACED") {
            const participant = participants.find((item) => item.slotId === event.payload.slotId);
            if (participant) {
                participant.displayName = event.payload.displayName;
                participant.ghost = false;
            }
        }
        else if (event.type === "PARTICIPANT_SET_GHOST") {
            const participant = participants.find((item) => item.slotId === event.payload.slotId);
            if (participant) {
                participant.displayName = event.payload.displayName;
                participant.ghost = true;
            }
        }
        else if (event.type === "PARTICIPANT_REMOVED") {
            const index = participants.findIndex((item) => item.slotId === event.payload.slotId);
            if (index >= 0)
                participants.splice(index, 1);
        }
        else if (event.type === "TOURNAMENT_OPENED") {
            tournamentOpened = true;
            sectorCount = event.payload.sectorCount;
            periodsPerRound = event.payload.periodsPerRound;
        }
        else if (event.type === "DRAW_SEEDED" && tournamentOpened) {
            matrix = event.payload.matrix;
        }
    }
    participants.sort((left, right) => left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId));
    return { participants, tournamentOpened, sectorCount, periodsPerRound, matrix };
}
const MAX_REGISTRATION_BATCH = 200;
export function numberedAthleteName(bibNumber) {
    return `Спортсмен №${bibNumber}`;
}
export function numberedRegistrationBatch(count) {
    return {
        participants: Array.from({ length: count }, (_, index) => ({
            bibNumber: index + 1,
            displayName: numberedAthleteName(index + 1),
            groupId: "A",
        })),
    };
}
export function parseRegistrationBatch(value) {
    if (!value || typeof value !== "object" || !("participants" in value) || !Array.isArray(value.participants)) {
        return { ok: false, error: "Файл регистрации должен содержать список participants" };
    }
    if (value.participants.length === 0)
        return { ok: false, error: "В пачке нет участников" };
    if (value.participants.length > MAX_REGISTRATION_BATCH) {
        return { ok: false, error: `В файле не больше ${MAX_REGISTRATION_BATCH} участников` };
    }
    const participants = [];
    for (const item of value.participants) {
        if (!item || typeof item !== "object")
            return { ok: false, error: "Участник в файле записан неверно" };
        const record = item;
        if (typeof record.displayName !== "string")
            return { ok: false, error: "У участника нет имени" };
        const entry = { displayName: record.displayName };
        if (record.bibNumber !== undefined) {
            if (typeof record.bibNumber !== "number") {
                return { ok: false, error: "Номер жеребьёвки должен быть целым числом от 1" };
            }
            entry.bibNumber = record.bibNumber;
        }
        if (record.groupId !== undefined) {
            if (record.groupId !== "A" && record.groupId !== "B")
                return { ok: false, error: "Группа должна быть A или B" };
            entry.groupId = record.groupId;
        }
        participants.push(entry);
    }
    return { ok: true, batch: { participants } };
}
/** PAL Trout: одна пара на сектор, нечётный участник занимает сектор один. */
export function requiredSectorCount(participantCount) {
    if (participantCount <= 0)
        return 0;
    return Math.ceil(participantCount / 2);
}
/** Имя фантома. Номер жеребьёвки в имени — тот же слот, не новый участник. */
export function phantomName(bibNumber) {
    return `ФАНТОМ ${bibNumber}`;
}
/**
 * Период 1 полной сетки: пары по порядку номеров, меньший слева.
 * Фантом место не освобождает: живой соперник остаётся один.
 */
export function planPeriodOne(participants, sectorCount) {
    if (!Number.isInteger(sectorCount) || sectorCount < 1)
        return [];
    const ordered = [...participants].sort(byBib).slice(0, sectorCount * 2);
    return matrixFromGrid(gridOf(ordered, 1), ordered);
}
/** Другое место того же сектора, если там фантом. */
export function ghostSeatPartner(participants, sectorCount, slotId) {
    for (const seat of sectorSeats(participants, sectorCount)) {
        if (seat.left.slotId === slotId)
            return seat.right?.ghost ? seat.right : null;
        if (seat.right?.slotId === slotId)
            return seat.left.ghost ? seat.left : null;
    }
    return null;
}
/** Ближайший живой сосед по секторам. Очки одиночки считаются против него, ему эти очки не идут. */
export function loneNeighborSlotId(participants, sectorCount, loneSlotId) {
    const seats = sectorSeats(participants, sectorCount);
    const sectorIndex = seats.findIndex((seat) => seat.left.slotId === loneSlotId || seat.right?.slotId === loneSlotId);
    if (sectorIndex < 0)
        return null;
    const loneOnLeft = seats[sectorIndex]?.left.slotId === loneSlotId;
    const nearestFirst = loneOnLeft ? [sectorIndex + 1, sectorIndex - 1] : [sectorIndex - 1, sectorIndex + 1];
    for (const index of nearestFirst) {
        const adjacent = seats[index];
        if (!adjacent)
            continue;
        const towardLone = index > sectorIndex ? [adjacent.left, adjacent.right] : [adjacent.right, adjacent.left];
        for (const candidate of towardLone) {
            if (isFishing(candidate) && candidate.slotId !== loneSlotId)
                return candidate.slotId;
        }
    }
    return null;
}
export function waitingParticipants(participants, sectorCount) {
    const seated = new Set();
    for (const duel of planPeriodOne(participants, sectorCount)) {
        if (duel.kind === "pair") {
            seated.add(duel.leftSlotId);
            seated.add(duel.rightSlotId);
        }
        else {
            seated.add(duel.loneSlotId);
        }
    }
    return participants.filter((participant) => !participant.ghost && !seated.has(participant.slotId));
}
function gridOf(participants, periodsCount) {
    return generateTournamentGrid([...participants].sort(byBib).map((participant) => participant.slotId), periodsCount);
}
function matrixFromGrid(grid, participants) {
    const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
    const grouped = new Map();
    for (const slot of grid) {
        const key = `${slot.round}:${slot.period}:${slot.sectorId}`;
        const list = grouped.get(key) ?? [];
        list.push(slot);
        grouped.set(key, list);
    }
    const matrix = [];
    const keys = [...grouped.keys()].sort((left, right) => compareMatrixKey(left) - compareMatrixKey(right) || left.localeCompare(right));
    for (const key of keys) {
        const slots = grouped.get(key) ?? [];
        const left = slots.find((slot) => slot.side === "left");
        const right = slots.find((slot) => slot.side === "right");
        const sample = left ?? right;
        if (!sample)
            continue;
        const leftPerson = left ? byId.get(left.slotId) : undefined;
        const rightPerson = right ? byId.get(right.slotId) : undefined;
        const leftFishing = isFishing(leftPerson ?? null);
        const rightFishing = isFishing(rightPerson ?? null);
        const owner = (leftFishing ? leftPerson : rightFishing ? rightPerson : leftPerson) ?? null;
        if (!owner)
            continue;
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
        if (!lone)
            continue;
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
function compareMatrixKey(key) {
    const [round = "0", period = "0", sector = "0"] = key.split(":");
    return Number(round) * 1000 + Number(period) * 100 + Number(sector);
}
function zoneOf(groupId, round) {
    if (groupId === "A")
        return round === 1 ? "blue" : "red";
    return round === 1 ? "red" : "blue";
}
function gridSeats(slots) {
    const bySector = new Map();
    for (const slot of slots) {
        const seat = bySector.get(slot.sectorId) ?? {
            sectorId: slot.sectorId,
            order: Number(slot.sectorId),
            left: null,
            right: null,
        };
        if (slot.side === "right")
            seat.right = slot;
        else
            seat.left = slot;
        bySector.set(slot.sectorId, seat);
    }
    return [...bySector.values()].sort((left, right) => left.order - right.order || left.sectorId.localeCompare(right.sectorId, undefined, { numeric: true }));
}
function gridNeighbor(slots, lone, ghosts) {
    const seats = gridSeats(slots);
    const sectorIndex = seats.findIndex((seat) => seat.left?.slotId === lone.slotId || seat.right?.slotId === lone.slotId);
    if (sectorIndex < 0)
        return null;
    const loneOnLeft = seats[sectorIndex]?.left?.slotId === lone.slotId;
    const nearestFirst = loneOnLeft ? [sectorIndex + 1, sectorIndex - 1] : [sectorIndex - 1, sectorIndex + 1];
    for (const index of nearestFirst) {
        const adjacent = seats[index];
        if (!adjacent)
            continue;
        const towardLone = index > sectorIndex ? [adjacent.left, adjacent.right] : [adjacent.right, adjacent.left];
        for (const candidate of towardLone) {
            if (!candidate || candidate.slotId === lone.slotId || ghosts.has(candidate.slotId))
                continue;
            return candidate.slotId;
        }
    }
    return null;
}
function viewFromGrid(participants, grid, slot) {
    const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
    const athlete = byId.get(slot.slotId);
    const opponent = slot.opponentSlotId ? byId.get(slot.opponentSlotId) : undefined;
    const sideLabel = slot.side === "left" ? "СЛЕВА" : "СПРАВА";
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
        };
    }
    const neighborId = gridNeighbor(periodSlots, slot, ghosts);
    const neighbor = neighborId ? byId.get(neighborId) : undefined;
    const vacant = opponent?.ghost === true;
    return {
        sectorLabel: slot.sectorId,
        sideLabel,
        athleteSlotId: slot.slotId,
        opponentSlotId: "",
        athleteName: athleteLabel(athlete),
        opponentName: vacant ? "Пустой слот" : "Нет соперника",
        briefing: neighbor
            ? `Вы в секторе ${slot.sectorId} ${sideLabel}, соперника в паре нет, сравнение с ${neighbor.displayName}`
            : `Вы в секторе ${slot.sectorId} ${sideLabel}, соперника в паре нет`,
    };
}
function athleteLabel(participant) {
    if (!participant)
        return "—";
    return `${participant.bibNumber}. ${participant.displayName}`;
}
/** Поимки «ПЛЮС»/«МИНУС» ещё не в IndexedDB, но уже должны двигать места. */
function unconfirmedCatches(state) {
    if (!state.tournamentOpened || state.saving || state.pending.length === 0)
        return [];
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
async function commitParticipantUpdate(set, previous, slotId, next, event, labels) {
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
    }
    catch (error) {
        set({
            setupSaving: false,
            participants: [...previous],
            ...labels?.rollback,
            setupError: error instanceof Error ? error.message : "Не удалось обновить участника",
        });
        return false;
    }
}
async function dropParticipants(set, state, slotIds) {
    const removing = new Set(slotIds);
    const previous = state.participants;
    const nextParticipants = previous.filter((participant) => !removing.has(participant.slotId));
    if (nextParticipants.length === previous.length)
        return false;
    const timestamp = Date.now();
    const events = [...removing].map((slotId, index) => ({
        id: crypto.randomUUID(),
        tournamentId: state.tournamentId,
        type: "PARTICIPANT_REMOVED",
        timestamp: timestamp + index,
        payload: { slotId },
    }));
    set({
        participants: nextParticipants,
        sectorCount: requiredSectorCount(nextParticipants.length),
        setupSaving: true,
        setupError: null,
    });
    try {
        await db.events.bulkAdd(events.map(toRecord));
        set({ setupSaving: false });
        return true;
    }
    catch (error) {
        set({
            setupSaving: false,
            participants: [...previous],
            sectorCount: requiredSectorCount(previous.length),
            setupError: error instanceof Error ? error.message : "Не удалось удалить участника",
        });
        return false;
    }
}
async function appendRegisteredParticipants(set, state, entries) {
    const normalized = normalizeRegistrationEntries(entries, state.participants);
    if (!normalized.ok) {
        set({ setupError: normalized.error });
        return false;
    }
    const timestamp = Date.now();
    const events = normalized.participants.map((participant, index) => ({
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
    const nextParticipants = [...state.participants, ...normalized.participants].sort(byBib);
    set({
        participants: nextParticipants,
        sectorCount: requiredSectorCount(nextParticipants.length),
        setupSaving: true,
        setupError: null,
    });
    try {
        await db.events.bulkAdd(events.map(toRecord));
        set({ setupSaving: false });
        return true;
    }
    catch (error) {
        set({
            setupSaving: false,
            participants: [...state.participants],
            sectorCount: requiredSectorCount(state.participants.length),
            setupError: error instanceof Error ? error.message : "Не удалось записать участников",
        });
        return false;
    }
}
function normalizeRegistrationEntries(entries, existing) {
    if (entries.length === 0)
        return { ok: false, error: "В пачке нет участников" };
    if (existing.length + entries.length > MAX_REGISTRATION_BATCH) {
        return { ok: false, error: `В стартовом листе не больше ${MAX_REGISTRATION_BATCH} участников` };
    }
    const used = new Set(existing.map((participant) => participant.bibNumber));
    let nextBib = existing.reduce((max, participant) => Math.max(max, participant.bibNumber), 0);
    const participants = [];
    for (const entry of entries) {
        const displayName = entry.displayName.trim();
        if (!displayName)
            return { ok: false, error: "У участника нет имени" };
        const groupId = entry.groupId ?? "A";
        if (groupId !== "A" && groupId !== "B")
            return { ok: false, error: "Группа должна быть A или B" };
        let bibNumber = entry.bibNumber;
        if (bibNumber === undefined) {
            nextBib += 1;
            bibNumber = nextBib;
        }
        else if (!Number.isInteger(bibNumber) || bibNumber < 1) {
            return { ok: false, error: "Номер жеребьёвки должен быть целым числом от 1" };
        }
        if (used.has(bibNumber))
            return { ok: false, error: `Номер ${bibNumber} уже занят` };
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
function sectorSeats(participants, sectorCount) {
    if (!Number.isInteger(sectorCount) || sectorCount < 1)
        return [];
    const active = [...participants].sort(byBib).slice(0, sectorCount * 2);
    const seats = [];
    for (let index = 0; index < active.length; index += 2) {
        const first = active[index];
        const second = active[index + 1] ?? null;
        if (!first)
            break;
        const [left, right] = !second || first.bibNumber <= second.bibNumber ? [first, second] : [second, first];
        seats.push({ sectorId: String(seats.length + 1), left, right });
    }
    return seats;
}
function isFishing(participant) {
    return participant !== null && !participant.ghost;
}
function loneComparisonEvents(tournamentId, participants, grid, timestamp) {
    const ghosts = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
    const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
    const events = [];
    const seen = new Set();
    for (const slot of grid) {
        if (ghosts.has(slot.slotId))
            continue;
        const opponent = slot.opponentSlotId ? byId.get(slot.opponentSlotId) : undefined;
        if (opponent && !opponent.ghost)
            continue;
        const key = `${slot.round}:${slot.period}:${slot.slotId}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const periodSlots = grid.filter((item) => item.round === slot.round && item.period === slot.period);
        const neighborSlotId = gridNeighbor(periodSlots, slot, ghosts);
        if (!neighborSlotId)
            continue;
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
function renamedLabels(state, bibNumber, slotId, displayName) {
    const label = `${bibNumber}. ${displayName}`;
    const participants = state.participants.map((participant) => participant.slotId === slotId ? { ...participant, displayName, ghost: false } : participant);
    const slot = state.grid.find((item) => item.slotId === state.athleteSlotId && item.round === state.round && item.period === state.period);
    const briefing = slot ? viewFromGrid(participants, state.grid, slot).briefing : state.briefing;
    return {
        athleteName: state.athleteSlotId === slotId ? label : state.athleteName,
        opponentName: state.opponentSlotId === slotId ? label : state.opponentName,
        briefing,
    };
}
function byBib(left, right) {
    return left.bibNumber - right.bibNumber || left.slotId.localeCompare(right.slotId);
}
/** Числа с экрана становятся итогом периода: старые дельты этого периода для пары удаляются. */
function absoluteCatches(state, slotIds, timestamp) {
    const countOf = new Map();
    if (state.athleteSlotId)
        countOf.set(state.athleteSlotId, state.athleteFish);
    if (state.opponentSlotId)
        countOf.set(state.opponentSlotId, state.opponentFish);
    const events = [];
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
async function replacePeriodCatches(tournamentId, round, period, slotIds, events) {
    const replacing = new Set(slotIds);
    await db.transaction("rw", db.events, async () => {
        const rows = await db.events.where("tournamentId").equals(tournamentId).toArray();
        const staleIds = rows.flatMap((row) => {
            const event = row.event;
            if (event.type !== "CATCH_RECORDED")
                return [];
            if (event.payload.round !== round || event.payload.period !== period)
                return [];
            if (!replacing.has(event.payload.slotId))
                return [];
            return [row.id];
        });
        if (staleIds.length > 0)
            await db.events.bulkDelete(staleIds);
        if (events.length > 0)
            await db.events.bulkAdd(events.map(toRecord));
    });
}
function isQualifyingPeriod(period) {
    return QUALIFYING_PERIODS.includes(period);
}
function cupPatch(events, participants, grid) {
    return {
        playoff: projectPlayoff(events),
        eighthPeriodClosed: isEighthPeriodClosed(events, participants, grid),
    };
}
function isEighthPeriodClosed(events, participants, grid) {
    const ghosts = new Set(participants.filter((participant) => participant.ghost).map((participant) => participant.slotId));
    const required = new Set(grid
        .filter((slot) => slot.round === 1 && slot.period === PERIODS_PER_ROUND && !ghosts.has(slot.slotId))
        .map((slot) => slot.slotId));
    if (required.size === 0)
        return false;
    const covered = new Set();
    for (const event of events) {
        if (event.type !== "PERIOD_COMPLETED" || event.payload.round !== 1 || event.payload.period !== PERIODS_PER_ROUND)
            continue;
        for (const protocol of event.payload.protocols) {
            if (!protocol.signed)
                continue;
            covered.add(protocol.slotIdA);
            if (protocol.slotIdB)
                covered.add(protocol.slotIdB);
        }
    }
    for (const slotId of required) {
        if (!covered.has(slotId))
            return false;
    }
    return true;
}
function viewFromPlayoff(participants, match) {
    const byId = new Map(participants.map((participant) => [participant.slotId, participant]));
    const athlete = match.slotIdA ? byId.get(match.slotIdA) : undefined;
    const opponent = match.slotIdB ? byId.get(match.slotIdB) : undefined;
    const stage = match.stage === "quarterfinal" ? "1/4 финала" : match.stage === "semifinal" ? "1/2 финала" : "Финал";
    const stageShort = match.stage === "quarterfinal" ? "1/4" : match.stage === "semifinal" ? "1/2" : "ФИНАЛ";
    return {
        sectorLabel: stageShort,
        sideLabel: "СЛЕВА",
        athleteSlotId: match.slotIdA ?? "",
        opponentSlotId: match.slotIdB ?? "",
        athleteName: athleteLabel(athlete),
        opponentName: athleteLabel(opponent),
        briefing: `${stage}: ${athlete?.displayName ?? "—"} (место ${match.placeA ?? "—"}) против ${opponent?.displayName ?? "—"} (место ${match.placeB ?? "—"}). При равных поимках побеждает более высокое место отбора.`,
    };
}
async function savePlayoffDuel(get, set) {
    const state = get();
    if (state.saving || !state.playoff.formed || !state.selectedPlayoffMatchId)
        return;
    const match = playoffMatches(state.playoff).find((item) => item.matchId === state.selectedPlayoffMatchId);
    if (!match?.slotIdA || !match.slotIdB) {
        set({ error: "Эта пара ещё не собрана" });
        return;
    }
    const event = {
        id: crypto.randomUUID(),
        tournamentId: state.tournamentId,
        type: "PLAYOFF_DUEL_SCORED",
        timestamp: Date.now(),
        payload: {
            matchId: match.matchId,
            slotIdA: match.slotIdA,
            slotIdB: match.slotIdB,
            fishA: state.athleteFish,
            fishB: state.opponentFish,
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
    }
    catch (error) {
        set({
            saving: false,
            error: error instanceof Error ? error.message : "Не удалось записать дуэль",
        });
    }
}
async function importPlayoffSnapshot(get, set, participant, cells) {
    const state = get();
    if (!state.playoff.formed)
        return { ok: false, error: "Сначала сформируйте плей-офф" };
    try {
        const rows = await db.events.where("tournamentId").equals(state.tournamentId).sortBy("timestamp");
        let next = rows.map((row) => row.event);
        const started = Date.now();
        for (let index = 0; index < cells.length; index += 1) {
            const cell = cells[index];
            if (!cell)
                continue;
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
        const selected = get().selectedPlayoffMatchId;
        if (selected && cells.some((cell) => playoffMatchId(cell.stage, cell.pair) === selected)) {
            const live = playoffMatches(get().playoff).find((item) => item.matchId === selected);
            if (live?.winnerSlotId)
                get().selectPlayoffMatch(selected);
        }
        return {
            ok: true,
            packet: {
                bibNumber: participant.bibNumber,
                displayName: participant.displayName,
                fish: totalFish(cells),
                periods: cells.length,
                cup: describeCupImport(get().participants, get().playoff, cells),
            },
        };
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Не удалось записать результаты",
        };
    }
}
function playoffSnapshot(state, records, slotId) {
    const cells = [];
    for (const match of playoffMatches(state.playoff)) {
        if (match.slotIdA !== slotId && match.slotIdB !== slotId)
            continue;
        const onScreen = state.selectedPlayoffMatchId === match.matchId;
        const started = state.confirmed || state.athleteFish > 0 || state.opponentFish > 0;
        const fish = onScreen && started && (slotId === state.athleteSlotId || slotId === state.opponentSlotId)
            ? slotId === state.athleteSlotId
                ? state.athleteFish
                : state.opponentFish
            : unsyncedPlayoffFish(records, match.matchId, slotId);
        if (fish === null)
            continue;
        cells.push({ stage: playoffStageCode(match.stage), pair: match.order + 1, fish });
    }
    return cells;
}
function unsyncedPlayoffFish(records, matchId, slotId) {
    let fish = null;
    for (const record of records) {
        if (record.isSynced)
            continue;
        const event = record.event;
        if (event.type === "PLAYOFF_DUEL_SCORED" && event.payload.matchId === matchId) {
            if (event.payload.slotIdA === slotId)
                fish = event.payload.fishA;
            if (event.payload.slotIdB === slotId)
                fish = event.payload.fishB;
        }
        else if (event.type === "PLAYOFF_SIDE_REPORTED" &&
            event.payload.matchId === matchId &&
            event.payload.slotId === slotId) {
            fish = event.payload.fish;
        }
    }
    return fish;
}
function describeCupImport(participants, playoff, cells) {
    const lines = cells.map((cell) => {
        const match = playoffMatches(playoff).find((item) => item.matchId === playoffMatchId(cell.stage, cell.pair));
        const title = `${cupStageLabel(cell.stage)}, пара ${cell.pair}`;
        if (!match || match.fishA === null || match.fishB === null || !match.winnerSlotId) {
            return `${title}: ${cell.fish} ${fishWord(cell.fish)}. Ждём соперника.`;
        }
        const winner = participants.find((item) => item.slotId === match.winnerSlotId);
        const winnerName = winner?.displayName ?? "победитель";
        const score = `${match.fishA}:${match.fishB}`;
        if (match.decidedBy === "qualifyingPlace") {
            return `${title}: ничья ${score}. Дальше ${winnerName} — более высокое место отбора.`;
        }
        return `${title}: ${score}. Дальше ${winnerName}.`;
    });
    return `${lines.join(" ")} Сетка обновлена.`;
}
function cupStageLabel(stage) {
    if (stage === "QF")
        return "Четвертьфинал";
    if (stage === "SF")
        return "Полуфинал";
    return "Финал";
}
function fishWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11)
        return "рыба";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
        return "рыбы";
    return "рыб";
}
async function replaceEventLog(before, after, synced) {
    const afterIds = new Set(after.map((event) => event.id));
    const beforeIds = new Set(before.map((row) => row.id));
    const deleteIds = before.flatMap((row) => (afterIds.has(row.id) ? [] : [row.id]));
    const added = after.filter((event) => !beforeIds.has(event.id));
    await db.transaction("rw", db.events, async () => {
        if (deleteIds.length > 0)
            await db.events.bulkDelete(deleteIds);
        if (added.length > 0)
            await db.events.bulkAdd(added.map((event) => (synced ? toSyncedRecord(event) : toRecord(event))));
    });
}
function toRecord(event) {
    return {
        id: event.id,
        tournamentId: event.tournamentId,
        type: event.type,
        timestamp: event.timestamp,
        isSynced: false,
        event,
    };
}
function toSyncedRecord(event) {
    return { ...toRecord(event), isSynced: true };
}
function periodKey(cell) {
    return `${cell.round}.${cell.period}`;
}
export function formatClock(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
