/** Атомарная отправка улова периода. Очередь и повтор живут на телефоне, не здесь. */
export interface MatchSideReport {
    bibNumber: number;
    opponentBib: number | null;
    ownFish: number;
    opponentFish: number;
}
export interface SyncMatch {
    id: string;
    period: number;
    status: "PENDING" | "CONFIRMED" | "CONFLICT";
    reports: MatchSideReport[];
}
export declare function postMatchReport(report: MatchSideReport & {
    period: number;
}): Promise<boolean>;
export declare function fetchMatchSync(): Promise<{
    ok: true;
    matches: SyncMatch[];
} | {
    ok: false;
}>;
