import { buildFinalStandings, type FinalStanding } from "./finalStandings.ts";
import type { GroupId, LeaderboardEntry, PlayoffProjection, TournamentEvent } from "./types.ts";

export interface ArchiveParticipant {
  slotId: string;
  bibNumber: number;
  displayName: string;
  groupId: GroupId;
  ghost: boolean;
}

export interface TournamentMeta {
  id: string;
  name: string;
  date: string;
  sectorCount: number;
  periodsCount: number;
}

/**
 * Снимок, который уходит в PostgreSQL и открывается по прямой ссылке.
 * Финальный лидерборд, лог поимок и сетка уже посчитаны: страница архива их не пересчитывает.
 */
export interface TournamentArchiveSnapshot {
  tournament: TournamentMeta;
  participants: ArchiveParticipant[];
  finalStandings: FinalStanding[];
  qualifyingLeaderboard: LeaderboardEntry[];
  catches: TournamentEvent[];
  playoff: PlayoffProjection;
}

const CATCH_TYPES = new Set<TournamentEvent["type"]>([
  "CATCH_RECORDED",
  "PLAYOFF_DUEL_SCORED",
  "PLAYOFF_SIDE_REPORTED",
]);

/** null, пока не сыграны финал и матч за 3-е место. */
export function buildTournamentArchive(input: {
  tournament: TournamentMeta;
  participants: readonly ArchiveParticipant[];
  qualifyingLeaderboard: readonly LeaderboardEntry[];
  playoff: PlayoffProjection;
  events: readonly TournamentEvent[];
}): TournamentArchiveSnapshot | null {
  const participants = input.participants.map((person) => ({ ...person }));
  const qualifyingLeaderboard = input.qualifyingLeaderboard.map((entry) => ({
    ...entry,
    periods: entry.periods.map((period) => ({ ...period })),
  }));
  const finalStandings = buildFinalStandings({
    playoff: input.playoff,
    leaderboard: qualifyingLeaderboard,
    participants,
  });
  if (!finalStandings) return null;

  return {
    tournament: { ...input.tournament },
    participants,
    finalStandings,
    qualifyingLeaderboard,
    catches: input.events.filter((event) => CATCH_TYPES.has(event.type)),
    playoff: input.playoff,
  };
}
