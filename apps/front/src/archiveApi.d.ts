import type { TournamentArchiveSnapshot } from "../../../packages/shared/src/archive.ts";
export type ArchivePostResult = {
    ok: true;
    id: string;
    path: string;
} | {
    ok: false;
    error: string;
};
export type ArchiveListItem = {
    id: string;
    name: string;
    date: string;
    champion: string;
};
export declare function postTournamentArchive(snapshot: TournamentArchiveSnapshot, tournamentId?: string): Promise<ArchivePostResult>;
export declare function listTournamentArchives(): Promise<{
    ok: true;
    archives: ArchiveListItem[];
} | {
    ok: false;
    error: string;
}>;
export declare function deleteTournamentArchive(id: string): Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
}>;
export declare function loadTournamentArchive(id: string): Promise<{
    ok: true;
    snapshot: TournamentArchiveSnapshot;
} | {
    ok: false;
    error: string;
}>;
export declare function isArchiveSnapshot(value: unknown): value is TournamentArchiveSnapshot;
