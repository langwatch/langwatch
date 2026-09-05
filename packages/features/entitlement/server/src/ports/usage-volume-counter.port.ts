import type { USAGE_UNKNOWN } from "./usage-counter.port";

/** One project's share of an organization's volume this period. */
export type ProjectUsageCount = { projectId: string; count: number };

/**
 * The per-project breakdown, or {@link USAGE_UNKNOWN} when the counting store could not answer.
 * The sentinel travels rather than a zero for the same reason it does on a single count: an
 * unreachable store and a quiet month are different facts.
 */
export type ProjectUsageCounts = ProjectUsageCount[] | typeof USAGE_UNKNOWN;

/**
 * Counts one organization's billable volume in ONE unit. Two of these are
 * composed — traces and events — and the meter decision picks between them, so
 * neither has to know the pricing model.
 */
export abstract class UsageVolumeCounterPort {
  abstract getCountByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts>;
}
