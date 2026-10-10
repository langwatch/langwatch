/**
 * The one derivation of the inbox, shared by the page, the bell and the sidebar count so the
 * three never disagree. A folder is derived, never stored.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { InsightEntry, InsightTone } from "./insight.ts";

export const INSIGHT_FOLDERS = ["inbox", "stale", "archived"] as const;
export type InsightFolder = (typeof INSIGHT_FOLDERS)[number];

const DAY_MS = 86_400_000;

/** When the insight was last confirmed true: renewed by a run, or filed. */
export function insightEffectiveAt(entry: InsightEntry): number {
  return entry.renewedAt ?? entry.filedAt;
}

/** The moment the insight drops to Stale unless something renews it. */
export function insightExpiresAt(entry: InsightEntry): number {
  return insightEffectiveAt(entry) + entry.validDays * DAY_MS;
}

/** Archived once the reader marked it done; kept or still valid is Inbox; otherwise Stale. */
export function insightFolder({ entry, now }: { entry: InsightEntry; now: number }): InsightFolder {
  if (entry.archivedAt !== null) return "archived";
  if (entry.keptAt !== null || now < insightExpiresAt(entry)) return "inbox";
  return "stale";
}

export type InsightInbox = Readonly<{
  inbox: readonly InsightEntry[];
  stale: readonly InsightEntry[];
  archived: readonly InsightEntry[];
  /** Inbox entries this reader has not seen yet. */
  unseen: readonly InsightEntry[];
  /** What the bell and the sidebar count show. */
  count: number;
  /** Langy's verdict balance over the unseen news: more good than bad reads green. */
  tone: "good" | "bad";
}>;

function countTone(entries: readonly InsightEntry[], tone: InsightTone): number {
  return entries.filter((entry) => entry.tone === tone).length;
}

export function deriveInsightInbox({
  entries,
  now,
}: {
  entries: readonly InsightEntry[];
  now: number;
}): InsightInbox {
  const sorted = entries.toSorted(
    (a, b) => insightEffectiveAt(b) - insightEffectiveAt(a) || a.id.localeCompare(b.id),
  );
  const folders: Record<InsightFolder, InsightEntry[]> = { inbox: [], stale: [], archived: [] };
  for (const entry of sorted) folders[insightFolder({ entry, now })].push(entry);
  const unseen = folders.inbox.filter((entry) => entry.seenAt === null);

  return {
    ...folders,
    unseen,
    count: unseen.length,
    tone: countTone(unseen, "good") >= countTone(unseen, "bad") ? "good" : "bad",
  };
}

/** The body with its section headers removed and collapsed to one line, for previews. */
export function insightSnippet(entry: InsightEntry): string {
  return entry.body
    .replace(/\*\*[^*]+\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
