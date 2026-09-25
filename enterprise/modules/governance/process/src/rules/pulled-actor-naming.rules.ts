// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { type Instant, Temporal } from "@langwatch/time";

/**
 * The line of ADR-129 Decision 2, a UTC day. A re-read that named a day recorded blank would
 * file its money in a second cell, so only days on or after this line - or every day of a
 * source created after it - are named.
 */
export const PULLED_ACTOR_NAMING_STARTS_AT = "2026-10-01";

const NAMING_STARTS_AT = Temporal.Instant.from(`${PULLED_ACTOR_NAMING_STARTS_AT}T00:00:00.000Z`);

/** The actor a pulled day is recorded under: what the provider said, or `""` (ADR-129). */
export function actorForPulledDay({
  sourceCreatedAt,
  dayUtc,
  reportedActor,
}: {
  sourceCreatedAt: Instant;
  /** The business day being priced, `YYYY-MM-DD` UTC. */
  dayUtc: string;
  reportedActor: string;
}): string {
  if (reportedActor === "") return "";
  if (Temporal.Instant.compare(sourceCreatedAt, NAMING_STARTS_AT) >= 0) return reportedActor;
  return dayUtc >= PULLED_ACTOR_NAMING_STARTS_AT ? reportedActor : "";
}
