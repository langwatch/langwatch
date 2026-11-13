// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/**
 * Whether an ingestion source takes events: the one answer every door asks.
 *
 * The push receivers, the pull scheduler, the pull worker and every screen
 * that shows a source as on or off read it from this file. When the push door
 * spelled it as "not archived" while pull spelled it as "not disabled", a
 * disabled source kept ingesting (GOV-01). The `ingestion-source-status-literal`
 * lint rule reports any other spelling in the governance module.
 */

/**
 * The statuses that take events. Anything else, a status no release knows included, is off.
 *
 * Exported for the one reader that cannot call a function: a database write that must skip a
 * row that is off builds its `status in (...)` predicate from this list.
 */
export const INGESTION_SOURCE_LIVE_STATUSES = ["active", "awaiting_first_event"] as const;

const LIVE_STATUSES: ReadonlySet<string> = new Set(INGESTION_SOURCE_LIVE_STATUSES);

/** An admin switched the source off (archiving does too), or the status is one no rule names. */
export function ingestionSourceStatusIsOff(status: string): boolean {
  return !LIVE_STATUSES.has(status);
}

/**
 * Neither archived nor switched off: the source takes events, pushed or pulled.
 * `archivedAt` is an instant or date on the server and an ISO string on the wire.
 */
export function ingestionSourceIsLive(source: {
  status: string;
  archivedAt: object | string | null;
}): boolean {
  return source.archivedAt === null && !ingestionSourceStatusIsOff(source.status);
}

/**
 * Puller health, derived rather than stored (ADR-128).
 *
 * Health is NOT a fourth `IngestionSource.status` value. Status says what an
 * admin configured -- active, disabled, awaiting its first event -- and a
 * broken provider must not be able to rewrite that. Health is a read-time
 * function of two facts the fold already keeps: how many runs in a row have
 * failed, and when a run last succeeded.
 */

/**
 * Failures in a row before a source is called unhealthy.
 *
 * One is a flake: providers time out, tokens refresh late, a window is
 * briefly empty. Three in a row is a pattern, and a pattern is worth a badge.
 */
export const UNHEALTHY_AFTER_CONSECUTIVE_FAILURES = 3;

export type SourceHealth = "healthy" | "unhealthy";

export function deriveSourceHealth({
  consecutiveFailures,
}: {
  consecutiveFailures: number;
}): SourceHealth {
  return consecutiveFailures >= UNHEALTHY_AFTER_CONSECUTIVE_FAILURES ? "unhealthy" : "healthy";
}

/**
 * Whether a pull has reached into the day starting at `dayStartMs`.
 *
 * A day nothing ever read holds no data we asked the provider for, so its
 * spend is unknown -- not zero. A day a read reached into was asked about, so
 * an empty day there really is a day with no spend. Callers render the two
 * differently, which is the whole point: "we spent nothing" and "we don't
 * know" are opposite answers.
 *
 * The moment compared against is the point the DATA reaches, never the moment
 * a run happened to finish. Two shapes make those different, and both are
 * ordinary rather than exceptional. A run stopped by a page limit or by its
 * own deadline finishes at a perfectly normal-looking instant having read far
 * less than the period it was asked for. And a provider that publishes late
 * leaves a gap behind even a run that drained everything on offer -- which is
 * every provider, by a day or more. Reasoning from the run clock hands the
 * reader "no spend" for days nobody ever read.
 *
 * `readThroughMs` is optional for the callers that predate it: a source whose
 * runs never recorded a read-through point still falls back to the moment its
 * last run succeeded, which is the answer it had before. A source that has
 * never completed a run but did read part of a period still covers what it
 * read -- the days really were asked about.
 */
export function isDayCoveredByPull({
  dayStartMs,
  lastSuccessfulPullMs,
  readThroughMs,
}: {
  dayStartMs: number;
  lastSuccessfulPullMs: number | null;
  /** The newest bucket the last run actually read through to, when known. */
  readThroughMs?: number | null;
}): boolean {
  const reachedMs = readThroughMs ?? lastSuccessfulPullMs;
  return reachedMs !== null && dayStartMs <= reachedMs;
}

/**
 * Whether a run read the whole period it was asked for.
 *
 * Two states rather than three: a page limit and a deadline both leave the
 * provider holding pages, and the customer-visible fact is the same one. A
 * reader with two reasons to distinguish would have to decide which of them
 * counts as collected, and neither does.
 */
export type RunCompleteness = "complete" | "truncated";

/**
 * What the line under a source says, in one of its two shapes.
 *
 * The truncated shape carries no `lastSuccessIso` AT ALL rather than a null
 * one. A collection that never finished has no date it collected through, and
 * a field holding null is still a field a caller can render as a date it
 * failed to read.
 */
export type NoDataSinceNotice =
  | { lastSuccessIso: string }
  | { readThroughIso: string; finished: false };

function toIso(at: Instant | string | null): string | null {
  if (at === null) return null;
  return typeof at === "string" ? at : at.toString({ fractionalSecondDigits: 3 });
}

/**
 * The line under a broken source: how far back the numbers can be trusted.
 *
 * Returns null while the source is healthy, and null when it has never
 * pulled successfully -- there is no "since" to name in either case, and the
 * awaiting-first-event badge already covers the second.
 *
 * Disabled is checked first, for the reason the badge checks it first: a
 * source nobody asked to run has not "stopped pulling". Retained failures
 * from before it was switched off would otherwise put an outage notice under
 * a source whose badge, correctly, reads Disabled.
 *
 * This lives beside the health rule rather than with the badge that first
 * needed it, because the cost screen asks the same question about the same
 * sources (ADR-128 s4a) and must not import a module that pulls in icons.
 */
export function deriveNoDataSinceNotice({
  status,
  errorCount,
  lastSuccessAt,
  completeness,
  readThroughAt,
}: {
  status: string;
  errorCount: number;
  lastSuccessAt: Instant | string | null;
  /** Whether the last run drained the period it was asked for. */
  completeness?: RunCompleteness | null;
  /** The newest bucket that run actually read through to. */
  readThroughAt?: Instant | string | null;
}): NoDataSinceNotice | null {
  if (ingestionSourceStatusIsOff(status)) return null;

  // A run that stopped at a page limit or ran out of time ends with nothing
  // to report as an error, so the failure count says the source is fine and
  // the only honest thing left to say is how far the reading got. Checked
  // before the health rule for exactly that reason: waiting for three
  // failures would keep the notice off a source that is never going to fail.
  //
  // The answer is a DIFFERENT SHAPE from the one below, and deliberately so.
  // It names the point the data reaches and no date for the collection, so
  // nothing can read a completed period out of it. The instant the run
  // finished is not offered at all -- it is the one value that moves on every
  // attempt, so a source stuck on the same half of its data would otherwise
  // read as making progress.
  if (completeness === "truncated") {
    const readThroughIso = toIso(readThroughAt ?? null);
    if (readThroughIso !== null) return { readThroughIso, finished: false };
  }

  if (deriveSourceHealth({ consecutiveFailures: errorCount }) === "healthy") {
    return null;
  }
  const iso = toIso(lastSuccessAt);
  if (iso === null) return null;
  return { lastSuccessIso: iso };
}
