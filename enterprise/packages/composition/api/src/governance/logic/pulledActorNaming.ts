// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one shared named-or-blank rule for pulled spend (ADR-129 Decisions 2+3).
 *
 * Pullers re-read recent days to catch provider restatements, and the rollup
 * cell key includes the actor. A re-read that NAMED a day recorded blank would
 * land its money in a new cell while the old cell keeps the figure — the day
 * shown twice. So a day is named only when nothing blank was ever recorded for
 * it: from a fixed line forward for sources that predate the line, and for all
 * of history on a source created after it, which has no old unnamed figures to
 * collide with.
 *
 * Written once and called from the one seam every adapter's usage passes
 * through, because two copies of a date comparison are two lines, and money
 * pulled under one and re-read under the other is exactly the double-count
 * this rule exists to prevent.
 */

/**
 * The line of ADR-129 Decision 2, a UTC day.
 *
 * MUST be on or after the day the release PR merges (ADR-129, Gates). Set
 * earlier than deploy, days in the gap get pulled blank by old code and named
 * by new code — the double-count. Later than deploy only costs some days their
 * name, which is the safe direction.
 */
export const PULLED_ACTOR_NAMING_STARTS_AT = "2026-10-01";

const NAMING_STARTS_AT_MS = Date.parse(
  `${PULLED_ACTOR_NAMING_STARTS_AT}T00:00:00.000Z`,
);

/**
 * The actor a pulled day is recorded under: what the provider said, or `""`.
 *
 * `""` means the provider named nobody, the bucket is coarser than one person,
 * or the day is pre-line — never a guess (ADR-129, Invariants). The value never
 * enters a restatement key or a dimension bucket; it rides the event payload
 * only (Decision 4).
 */
export function actorForPulledDay({
  sourceCreatedAt,
  dayUtc,
  reportedActor,
}: {
  /** `IngestionSource.createdAt` — the line comparison needs no stored field. */
  sourceCreatedAt: Date;
  /** The business day being priced, as `YYYY-MM-DD` UTC. */
  dayUtc: string;
  /** What the provider said; `""` when it said nothing. */
  reportedActor: string;
}): string {
  if (reportedActor === "") return "";
  // A source created on or after the line has no blank history to collide
  // with, so every day it ever reads is named — backfills included.
  if (sourceCreatedAt.getTime() >= NAMING_STARTS_AT_MS) return reportedActor;
  // A pre-existing source recorded blank days before the line, and those cells
  // must keep their identity forever: only days on or after the line are named.
  return dayUtc >= PULLED_ACTOR_NAMING_STARTS_AT ? reportedActor : "";
}
