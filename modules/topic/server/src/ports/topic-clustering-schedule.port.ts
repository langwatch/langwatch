import type { Instant } from "@langwatch/time";

/** Eventing-owned schedule read needed by the Topic status projection. */
export abstract class TopicClusteringSchedulePort {
  abstract findNextWakeAt(input: { projectId: string }): Promise<Instant | null>;
}
