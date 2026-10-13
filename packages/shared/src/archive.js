"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTournamentArchive = buildTournamentArchive;
const finalStandings_ts_1 = require("./finalStandings.ts");
const CATCH_TYPES = new Set([
    "CATCH_RECORDED",
    "PLAYOFF_DUEL_SCORED",
    "PLAYOFF_SIDE_REPORTED",
]);
/** null, пока не сыграны финал и матч за 3-е место. */
function buildTournamentArchive(input) {
    const participants = input.participants.map((person) => ({ ...person }));
    const qualifyingLeaderboard = input.qualifyingLeaderboard.map((entry) => ({
        ...entry,
        periods: entry.periods.map((period) => ({ ...period })),
    }));
    const finalStandings = (0, finalStandings_ts_1.buildFinalStandings)({
        playoff: input.playoff,
        leaderboard: qualifyingLeaderboard,
        participants,
    });
    if (!finalStandings)
        return null;
    return {
        tournament: { ...input.tournament },
        participants,
        finalStandings,
        qualifyingLeaderboard,
        catches: input.events.filter((event) => CATCH_TYPES.has(event.type)),
        playoff: input.playoff,
    };
}
