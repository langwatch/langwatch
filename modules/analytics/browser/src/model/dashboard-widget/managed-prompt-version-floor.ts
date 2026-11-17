/**
 * Whether a widget that reads `LastUsedPromptVersionId` may show its rows. Older trace rows carry
 * the column only once the managed prompt version replay is done, so until then, and over a
 * window reaching before the replay's since, the rows could be wrong: a notice replaces them.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */

import type { LangWatchQLManagedPromptVersionFloor } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

/** The floor as the browser holds it: still loading, a read that failed, or the server's answer. */
export type ManagedPromptVersionFloorRead =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "read"; readonly floor: LangWatchQLManagedPromptVersionFloor };

/** What the widget shows: nothing yet, a notice in place of its body, or its body. */
export type ManagedPromptVersionGate =
  | { readonly kind: "loading" }
  | { readonly kind: "notice"; readonly notice: string }
  | { readonly kind: "body" };

export const PROMPT_VERSION_HISTORY_REBUILDING_NOTICE =
  "Prompt version history is still being rebuilt";
export const PROMPT_VERSION_HISTORY_UNKNOWN_NOTICE = "Prompt version history unknown";

const READS_MANAGED_PROMPT_VERSION = /\bLastUsedPromptVersionId\b/;

/** The day the notice names, as the span data notice does: "10 Oct 2026", in UTC. */
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const BODY: ManagedPromptVersionGate = { kind: "body" };

/** Whether any of a widget's queries reads `LastUsedPromptVersionId`. */
export function readsManagedPromptVersion(queries: readonly { readonly sql: string }[]): boolean {
  return queries.some((query) => READS_MANAGED_PROMPT_VERSION.test(query.sql));
}

/**
 * The gate over a widget reading the managed prompt version. Its window is the period and the
 * one before it, as att-change reads both, so it starts one period length before the period.
 */
export function managedPromptVersionGate({
  read,
  timeWindow,
}: {
  readonly read: ManagedPromptVersionFloorRead;
  /** The period, epoch milliseconds. */
  readonly timeWindow: { readonly start: number; readonly end: number };
}): ManagedPromptVersionGate {
  if (read.status === "loading") return { kind: "loading" };
  if (read.status === "failed" || read.floor.unknown) {
    return { kind: "notice", notice: PROMPT_VERSION_HISTORY_UNKNOWN_NOTICE };
  }
  if (read.floor.rebuilding) {
    return { kind: "notice", notice: PROMPT_VERSION_HISTORY_REBUILDING_NOTICE };
  }
  if (read.floor.from === null) return BODY;
  const from = Temporal.Instant.from(read.floor.from).epochMilliseconds;
  const windowStart = timeWindow.start - (timeWindow.end - timeWindow.start);
  if (windowStart >= from) return BODY;
  return { kind: "notice", notice: `Prompt versions known from ${DAY.format(from)}` };
}
