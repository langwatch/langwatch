import crypto from "crypto";

import { Temporal, toDate } from "@langwatch/time";

export const TOPIC_CLUSTERING_PROCESS_NAME = "topicClustering" as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The project's stable minute of the UTC day, derived from a sha256 of its
 * id (ADR-051 §"On wake").
 */
function dailySlotOffsetMs(projectId: string): number {
  const digest = crypto.createHash("sha256").update(projectId).digest();
  const minuteOfDay = digest.readUInt32BE(0) % (24 * 60);
  return minuteOfDay * 60 * 1000;
}

/** The next occurrence of the project's daily slot strictly after `afterMs`. */
export function nextDailySlot({
  projectId,
  afterMs,
}: {
  projectId: string;
  afterMs: number;
}): number {
  const dayStart = Temporal.Instant.fromEpochMilliseconds(afterMs)
    .toZonedDateTimeISO("UTC")
    .startOfDay().epochMilliseconds;
  const candidate = dayStart + dailySlotOffsetMs(projectId);
  return candidate > afterMs ? candidate : candidate + DAY_MS;
}

/**
 * `20260717T093000` — the scheduled run identity, from the instant the wake actually started
 * the run (second precision). The instant — not just the UTC date — must be part of the
 * identity.
 */
export function runIdForSlot(slotMs: number): string {
  return toDate(Temporal.Instant.fromEpochMilliseconds(slotMs))
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "");
}
