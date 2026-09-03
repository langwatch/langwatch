// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
  return consecutiveFailures >= UNHEALTHY_AFTER_CONSECUTIVE_FAILURES
    ? "unhealthy"
    : "healthy";
}

/**
 * Whether a successful pull has reached into the day starting at `dayStartMs`.
 *
 * A day beginning after the last successful pull holds no data we ever asked
 * the provider for, so its spend is unknown -- not zero. A day the last
 * successful pull fell inside was reached, so an empty day there really is a
 * day with no spend. Callers render the two differently, which is the whole
 * point: "we spent nothing" and "we don't know" are opposite answers.
 */
export function isDayCoveredByPull({
  dayStartMs,
  lastSuccessfulPullMs,
}: {
  dayStartMs: number;
  lastSuccessfulPullMs: number | null;
}): boolean {
  return lastSuccessfulPullMs !== null && dayStartMs <= lastSuccessfulPullMs;
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
export function noDataSinceNotice({
  status,
  errorCount,
  lastSuccessAt,
}: {
  status: string;
  errorCount: number;
  lastSuccessAt: Date | string | null;
}): { lastSuccessIso: string } | null {
  if (status === "disabled") return null;
  if (deriveSourceHealth({ consecutiveFailures: errorCount }) === "healthy") {
    return null;
  }
  if (lastSuccessAt === null) return null;
  const iso =
    typeof lastSuccessAt === "string"
      ? lastSuccessAt
      : lastSuccessAt.toISOString();
  return { lastSuccessIso: iso };
}
