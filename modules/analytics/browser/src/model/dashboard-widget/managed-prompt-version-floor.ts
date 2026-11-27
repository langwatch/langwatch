/**
 * Whether a widget reading `LastUsedPromptVersionId` from trace_metrics may show its rows. Older
 * rows carry it only once the managed prompt version replay is done, so until then a notice
 * replaces them; over a window reaching before the replay's since, a note says where they start.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */

import type { LangWatchQLManagedPromptVersionFloor } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

/** The floor as the browser holds it: still loading, a read that failed, or the server's answer. */
export type ManagedPromptVersionFloorRead =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "read"; readonly floor: LangWatchQLManagedPromptVersionFloor };

/** What the widget shows: nothing yet, a notice in place of its body, or its body with any note. */
export type ManagedPromptVersionGate =
  | { readonly kind: "loading" }
  | { readonly kind: "notice"; readonly notice: string }
  | { readonly kind: "body"; readonly note?: string };

export const PROMPT_VERSION_HISTORY_REBUILDING_NOTICE =
  "Prompt version history is still being rebuilt";
export const PROMPT_VERSION_HISTORY_UNKNOWN_NOTICE = "Prompt version history unknown";

const MANAGED_PROMPT_VERSION = /\bLastUsedPromptVersionId\b/;
const FROM_TRACE_METRICS = /\b(?:FROM|JOIN)\s+(?:[a-z_]+\.)?trace_metrics(?:__floor)?\b/i;
const UNION = /\bUNION\s+(?:ALL|DISTINCT)\b/i;
const OPENS_SUBQUERY = /^\s*(?:SELECT|WITH)\b/i;
const LINE_COMMENT = /--[^\n]*/g;

/** The day the notice names, as the span data notice does: "10 Oct 2026", in UTC. */
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const BODY: ManagedPromptVersionGate = { kind: "body" };

/** The index just past the string literal opening at `start`; ClickHouse escapes ' as '' or \'. */
function literalEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\") index += 2;
    else if (char !== "'") index++;
    else if (text.charAt(index + 1) === "'") index += 2;
    else return index + 1;
  }
  return text.length;
}

/**
 * Each SELECT of a statement as its own text: a subquery's parentheses cut it out into its own
 * entry, a function call's do not, a string literal's are text, and UNION branches split apart.
 */
function selectsOf(sql: string): string[] {
  const text = sql.replace(LINE_COMMENT, "");
  const open: string[] = [""];
  const closed: string[] = [];
  const opensSubquery: boolean[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === "'") {
      const end = literalEnd(text, index);
      open[open.length - 1] += text.slice(index, end);
      index = end - 1;
      continue;
    }
    if (char === "(") {
      const subquery = OPENS_SUBQUERY.test(text.slice(index + 1));
      opensSubquery.push(subquery);
      if (subquery) {
        open.push("");
        continue;
      }
    } else if (char === ")" && opensSubquery.pop() === true) {
      closed.push(open.pop() ?? "");
      continue;
    }
    open[open.length - 1] += char;
  }
  return [...closed, ...open].flatMap((select) => select.split(UNION));
}

/**
 * Whether any of a widget's queries reads `LastUsedPromptVersionId` from `trace_metrics`, the
 * only source the replay fills; a SELECT reading it from `traces` is complete without it.
 */
export function readsManagedPromptVersionFromTraceMetrics(
  queries: readonly { readonly sql: string }[],
): boolean {
  return queries.some((query) =>
    selectsOf(query.sql).some(
      (select) => MANAGED_PROMPT_VERSION.test(select) && FROM_TRACE_METRICS.test(select),
    ),
  );
}

/**
 * The gate over a widget reading the managed prompt version. Its window is the period and the
 * one before it, as att-change reads both. A window reaching before the since keeps its rows,
 * since 90d and 1y reach past the replay's 122 days, and notes where versions are known from.
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
  return { kind: "body", note: `Prompt versions known from ${DAY.format(from)}` };
}
