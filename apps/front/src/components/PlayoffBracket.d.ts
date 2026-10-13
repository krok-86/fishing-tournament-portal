import type { TournamentArchiveSnapshot } from "../../../../packages/shared/src/archive.ts";
import type { PlayoffStage } from "../../../../packages/shared/src/types.ts";
export declare function playoffStageTitle(stage: PlayoffStage): string;
export declare function PlayoffBracket({ snapshot, onArchive, archiving, archiveUrl, }?: {
    /** Готовый снимок архива. Живой турнир читается из журнала на телефоне. */
    snapshot?: TournamentArchiveSnapshot | null;
    onArchive?: () => void;
    archiving?: boolean;
    archiveUrl?: string | null;
}): import("react").JSX.Element | null;
export declare function PlayoffEntryDialog({ organizer }?: {
    organizer?: boolean;
}): import("react").JSX.Element | null;
