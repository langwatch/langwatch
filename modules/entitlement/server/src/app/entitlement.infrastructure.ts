import type {
  PricingModel,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
  UsageUnit,
} from "@langwatch/entitlement-contract";

export interface EntitlementInfrastructure {
  usageCounter: UsageCounter;
  usageOrganization: UsageOrganization;
  usageVolumeCounter: UsageVolumeCounter;
  usageWarning: UsageWarning;
}

/**
 * What a counter answers when it could not count.
 *
 * A sentinel rather than `0`, because the two are different facts: an
 * organization that genuinely sent nothing this month, and a counting store
 * that could not be reached. Every consumer used to read the second as the
 * first — enforcement saw an organization comfortably inside its cap, the
 * approaching-limit notifier saw nobody worth warning, and the usage page
 * rendered a confident zero. An outage in the counting store silently switched
 * off metering and told customers their usage had vanished.
 */
export const USAGE_UNKNOWN = "unknown" as const;

/** A usage count, or {@link USAGE_UNKNOWN} when it could not be determined. */
export type UsageCount = number | typeof USAGE_UNKNOWN;


export interface UsageCounter {
  /**
   * The real current-period volume, computed even for unlimited (seat-based)
   * plans where enforcement would not bother counting: the usage page shows
   * actual billable volume whatever the cap is.
   */
  getCurrentMonthCountForDisplay(
    input: Readonly<{ organizationId: string }>,
  ): Promise<UsageCount>;

  /** Whether this organization is metered in traces or in events. */
  getResolvedUsageUnit(input: Readonly<{ organizationId: string }>): Promise<UsageUnit>;
}

/**
 * What enforcement needs of the organization graph: which organization a team belongs to, which
 * projects it owns, and the pricing model a licence override is read against. The aggregate is
 * another feature's, so this is the shape rather than its repository.
 */
export interface UsageOrganization {
  tryGetOrganizationIdByTeamId(input: { teamId: string }): Promise<string | null>;

  getProjectIds(organizationId: string): Promise<string[]>;

  tryGetPricingModel(organizationId: string): Promise<PricingModel | null>;
}

/** Which unit an organization is metered in, once resolved. */
export interface UsageMeterReading {
  usageUnit: UsageUnit;
  reason: string;
}

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
export interface UsageVolumeCounter {
  getCountByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts>;
}

/**
 * The approaching-limit mail. Sending it needs the deployment's gateway, its
 * public host and the billing ladder the message quotes a next step from, none
 * of which this feature holds, so the send arrives as members.
 */
export interface UsageWarning {
  /** Reports nothing sent when the reading crossed no threshold, or the window still holds. */
  sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
}

/**
 * A short-lived per-key cache. Enforcement asks the same two questions on every ingested batch,
 * so the composition binds whatever it has — a Redis cache shared across pods, or a per-pod map
 * — and the absence of one only costs repeated reads.
 */
export interface UsageCache {
  tryGet<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}
