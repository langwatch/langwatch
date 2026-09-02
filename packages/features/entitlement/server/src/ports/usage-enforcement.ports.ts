import type { PricingModel } from "@langwatch/prisma-client/generated";
import type { UsageUnit } from "@langwatch/entitlement-contract";
import type { USAGE_UNKNOWN } from "./usage-counter.port";

/** One project's share of an organization's volume this period. */
export type ProjectUsageCount = { projectId: string; count: number };

/**
 * The per-project breakdown, or {@link USAGE_UNKNOWN} when the counting store
 * could not answer. The sentinel travels rather than a zero for the same
 * reason it does on a single count: an unreachable store and a quiet month are
 * different facts.
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

/**
 * What enforcement needs of the organization graph: which organization a team
 * belongs to, which projects it owns, and the pricing model a licence override
 * is read against. The aggregate is another feature's, so this is the shape
 * rather than its repository.
 */
export abstract class UsageOrganizationPort {
  abstract tryGetOrganizationIdByTeamId(input: {
    teamId: string;
  }): Promise<string | null>;

  abstract getProjectIds(organizationId: string): Promise<string[]>;

  abstract tryGetPricingModel(organizationId: string): Promise<PricingModel | null>;
}

/**
 * A short-lived per-key cache. Enforcement asks the same two questions on
 * every ingested batch, so the composition binds whatever it has — a Redis
 * cache shared across pods, or a per-pod map — and the absence of one only
 * costs repeated reads.
 */
export abstract class UsageCachePort {
  abstract get<T>(key: string): Promise<T | undefined>;
  abstract set<T>(key: string, value: T): Promise<void>;
}

/** A cache that remembers nothing, for a process that composed none. */
export class NoUsageCache extends UsageCachePort {
  async get<T>(): Promise<T | undefined> {
    return undefined;
  }
  async set<T>(): Promise<void> {}
}

/** Which unit an organization is metered in, once resolved. */
export interface UsageMeterReading {
  usageUnit: UsageUnit;
  reason: string;
}
