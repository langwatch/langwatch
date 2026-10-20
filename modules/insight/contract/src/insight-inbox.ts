/**
 * The one derivation of the inbox, shared by the page, the bell and the sidebar count so the
 * three never disagree, and the two of them insight lends the shell. A folder is derived.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { uiTokens } from "@langwatch/module";

import type { InsightEntry, InsightTone } from "./insight.ts";

export type InsightsBellProps = Record<string, never>;

/** The topbar bell with its unread pill and popover (§10.1); draws nothing without a project. */
export const InsightsBellToken = uiTokens("insight").component<InsightsBellProps>("insightsBell");

export type InsightsNavCountProps = Record<string, never>;

/** The unread pill beside the sidebar's Insights entry; draws nothing at zero. */
export const InsightsNavCountToken =
  uiTokens("insight").component<InsightsNavCountProps>("insightsNavCount");

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
  /** The most urgent verdict among the unseen news, so the pill names the next step. */
  tone: InsightTone;
}>;

/** Any `bad` reads Act now, else any `watch` reads Check this; only older `good` reads green. */
function unseenTone(unseen: readonly InsightEntry[]): InsightTone {
  if (unseen.some((entry) => entry.tone === "bad")) return "bad";
  if (unseen.some((entry) => entry.tone === "watch")) return "watch";
  return "good";
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
    tone: unseenTone(unseen),
  };
}

/** The body with its section headers removed and collapsed to one line, for previews. */
export function insightSnippet(entry: InsightEntry): string {
  return entry.body
    .replace(/\*\*[^*]+\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
