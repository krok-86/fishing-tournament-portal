import { apiUrl } from "./apiUrl.ts";

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

const REPORT_TIMEOUT_MS = 8000;

export async function postMatchReport(report: MatchSideReport & { period: number }): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl("/api/matches/report"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchMatchSync(): Promise<{ ok: true; matches: SyncMatch[] } | { ok: false }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl("/api/matches/sync"), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    const body: unknown = await response.json().catch(() => null);
    const matches = parseSyncMatches(body);
    if (!matches) return { ok: false };
    return { ok: true, matches };
  } catch {
    return { ok: false };
  } finally {
    window.clearTimeout(timer);
  }
}

function parseSyncMatches(body: unknown): SyncMatch[] | null {
  if (!isRecord(body) || !Array.isArray(body.matches)) return null;
  const matches: SyncMatch[] = [];
  for (const item of body.matches) {
    const parsed = parseMatch(item);
    if (parsed) matches.push(parsed);
  }
  return matches;
}

function parseMatch(value: unknown): SyncMatch | null {
  if (!isRecord(value)) return null;
  if (value.status !== "PENDING" && value.status !== "CONFIRMED" && value.status !== "CONFLICT") return null;
  if (typeof value.period !== "number" || !Number.isInteger(value.period)) return null;
  if (!Array.isArray(value.reports)) return null;
  const reports: MatchSideReport[] = [];
  for (const item of value.reports) {
    const report = parseReport(item);
    if (!report) return null;
    reports.push(report);
  }
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `${value.period}`;
  return { id, period: value.period, status: value.status, reports };
}

function parseReport(value: unknown): MatchSideReport | null {
  if (!isRecord(value)) return null;
  const bibNumber = whole(value.bibNumber);
  const ownFish = whole(value.ownFish);
  const opponentFish = whole(value.opponentFish);
  if (bibNumber === null || ownFish === null || opponentFish === null) return null;
  let opponentBib: number | null = null;
  if (value.opponentBib !== undefined && value.opponentBib !== null) {
    const parsed = whole(value.opponentBib);
    if (parsed === null) return null;
    opponentBib = parsed;
  }
  return { bibNumber, opponentBib, ownFish, opponentFish };
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
