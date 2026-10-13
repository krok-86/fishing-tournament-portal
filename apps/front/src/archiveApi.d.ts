import type { TournamentArchiveSnapshot } from "../../../packages/shared/src/archive.ts";
export type ArchivePostResult = {
    ok: true;
    id: string;
    path: string;
} | {
    ok: false;
    error: string;
};
export declare function postTournamentArchive(snapshot: TournamentArchiveSnapshot): Promise<ArchivePostResult>;
export declare function loadTournamentArchive(id: string): Promise<{
    ok: true;
    snapshot: TournamentArchiveSnapshot;
} | {
    ok: false;
    error: string;
}>;
export declare function isArchiveSnapshot(value: unknown): value is TournamentArchiveSnapshot;
