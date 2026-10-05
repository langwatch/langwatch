import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { PlanInfo, PricingModel, UsageUnit } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import { buildLimitMessage, type UsageDeployment } from "../rules/usage-limit-message.rules.ts";
import { resolveUsageMeter } from "../rules/usage-meter-policy.rules.ts";

const logger = createLogger("langwatch:usage");

/**
 * The allowance a plan states when it means "we do not cap this". Stated rather than imported
 * from the Enterprise billing contract, which a core package may not reach into — the same call
 * `usage-stats.service.ts` already makes for the same sentinel.
 */
const UNLIMITED_MESSAGES = 999_999_999;

/**
 * Sentinel when a counter cannot count, to distinguish from zero usage.
 * An outage must not silently disable metering.
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
  getCurrentMonthCountForDisplay(input: Readonly<{ organizationId: string }>): Promise<UsageCount>;

  /** Whether this organization is metered in traces or in events. */
  getResolvedUsageUnit(input: Readonly<{ organizationId: string }>): Promise<UsageUnit>;

  /** Main's enforcement read: whether the organization spent its monthly allowance. */
  checkLimitForOrganization(input: Readonly<{ organizationId: string }>): Promise<UsageLimitResult>;
}

/**
 * What enforcement needs of the organization graph: which organization a team belongs to, which
 * projects it owns, and the pricing model a licence override is read against. The aggregate is
 * another feature's, so this is the shape rather than its repository.
 */
export interface UsageOrganization {
  /**
   * Throws `organization_not_found_for_team`: enforcement refuses a tenant that does not
   * resolve rather than metering traffic against nobody's plan.
   */
  getOrganizationIdByTeamId(input: { teamId: string }): Promise<string>;

  getProjectIds(organizationId: string): Promise<string[]>;

  getPricingModel(organizationId: string): Promise<{ pricingModel: PricingModel | null }>;
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
 * A short-lived per-key cache. Enforcement asks the same two questions on every ingested batch,
 * so the composition binds whatever it has — a Redis cache shared across pods, or a per-pod map
 * — and the absence of one only costs repeated reads.
 */
export interface UsageCache {
  findValue<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export class NoUsageCache implements UsageCache {
  async findValue<T>(): Promise<T | undefined> {
    return undefined;
  }

  async set(): Promise<void> {}
}

export class InProcessUsageCache implements UsageCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async findValue<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}

/** The peers the live usage count reads through. */
export type EntitlementUsagePeers = Readonly<{
  traces: Pick<TraceApi, "countTracesByProjects">;
  billing: Pick<
    BillingApi,
    "countBillableEventsByProjects" | "getPricingModel" | "sendUsageWarning"
  >;
  organizations: Pick<OrganizationApi, "getOrganizationIdByTeamId" | "findAllIds">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
}>;

/** Main's 30-second count and meter-decision windows. */
const USAGE_CACHE_TTL_MS = 30_000;

/** A plan resolved for one organization. */
export type PlanResolver = (organizationId: string) => Promise<PlanInfo>;

export type UsageLimitResult =
  | { exceeded: false }
  | {
      exceeded: true;
      message: string;
      count: number;
      maxMessagesPerMonth: number;
      planName: string;
      usageUnit: UsageUnit;
    };

/** What enforcement is composed from: the counters, the plan, and the install. */
export interface UsageServiceDependencies {
  organizations: UsageOrganization;
  traceCounter: UsageVolumeCounter;
  eventCounter: UsageVolumeCounter;
  planResolver: PlanResolver;
  deployment: UsageDeployment;
  /** Both caches are 30-second windows in production; absent means uncached. */
  countCache?: UsageCache;
  decisionCache?: UsageCache;
}

/**
 * App-layer usage service. Orchestrates: plan → meter policy → counter. The meter policy
 * resolves the counting unit (traces/events). Counting execution is delegated to
 * TraceUsageService or EventUsageService depending on the resolved meter.
 */
export class UsageService {
  private readonly organizations: UsageOrganization;
  private readonly traceUsageService: UsageVolumeCounter;
  private readonly eventUsageService: UsageVolumeCounter;
  private readonly planResolver: PlanResolver;
  private readonly deployment: UsageDeployment;
  private readonly countCache: UsageCache;
  private readonly decisionCache: UsageCache;

  static create(deps: UsageServiceDependencies): UsageService {
    return new UsageService(deps);
  }

  /** Main's `UsageService` over the owners' counts: trace's traces, billing's events, pricing. */
  static overPeers(input: {
    isSaas: boolean;
    planResolver: PlanResolver;
    peers: EntitlementUsagePeers;
  }): UsageService {
    const { traces, billing, organizations, projects } = input.peers;
    return new UsageService({
      organizations: {
        getOrganizationIdByTeamId: (lookup) => organizations.getOrganizationIdByTeamId(lookup),
        getProjectIds: (organizationId) => projects.listIdsByOrganization({ organizationId }),
        getPricingModel: (organizationId) => billing.getPricingModel({ organizationId }),
      },
      traceCounter: { getCountByProjects: (counted) => traces.countTracesByProjects(counted) },
      eventCounter: {
        getCountByProjects: (counted) => billing.countBillableEventsByProjects(counted),
      },
      planResolver: input.planResolver,
      deployment: { isSaas: input.isSaas },
      countCache: new InProcessUsageCache(USAGE_CACHE_TTL_MS),
      decisionCache: new InProcessUsageCache(USAGE_CACHE_TTL_MS),
    });
  }

  private constructor(deps: UsageServiceDependencies) {
    this.organizations = deps.organizations;
    this.traceUsageService = deps.traceCounter;
    this.eventUsageService = deps.eventCounter;
    this.planResolver = deps.planResolver;
    this.deployment = deps.deployment;
    this.countCache = deps.countCache ?? new NoUsageCache();
    this.decisionCache = deps.decisionCache ?? new NoUsageCache();
  }

  async checkLimit({ teamId }: { teamId: string }): Promise<UsageLimitResult> {
    const organizationId = await this.organizations.getOrganizationIdByTeamId({ teamId });

    return this.checkLimitForOrganization({ organizationId });
  }

  async checkLimitForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageLimitResult> {
    const plan = await this.planResolver(organizationId);
    const count = await this.getCurrentMonthCount({ organizationId, plan });

    if (count === "unlimited") {
      return { exceeded: false };
    }

    if (count === USAGE_UNKNOWN) {
      // Deliberately permissive, and deliberately loud. Enforcement cannot say whether this
      // organization is over its cap, and locking a paying customer out of their own product
      // because OUR counting store is down is the worse of the two errors — so traffic
      // continues.
      logger.warn(
        { organizationId, plan: plan.name },
        "checkLimit: usage is unknown, allowing traffic without enforcement",
      );

      return { exceeded: false };
    }

    if (count >= plan.maxMessagesPerMonth) {
      // getCurrentMonthCount already warmed the decision cache, so this is a map lookup
      const decision = await this.getCachedUsageMeterReading(organizationId, plan);

      return {
        exceeded: true,
        message: buildLimitMessage({
          isFree: plan.free,
          limit: plan.maxMessagesPerMonth,
          usageUnit: decision.usageUnit,
          deployment: this.deployment,
        }),
        count,
        maxMessagesPerMonth: plan.maxMessagesPerMonth,
        planName: plan.name,
        usageUnit: decision.usageUnit,
      };
    }

    return { exceeded: false };
  }

  /**
   * Returns the resolved usage unit for the given organization.
   * Delegates to the cached meter decision.
   */
  async getResolvedUsageUnit({ organizationId }: { organizationId: string }): Promise<UsageUnit> {
    const decision = await this.getCachedUsageMeterReading(organizationId);

    return decision.usageUnit;
  }

  async getCurrentMonthCount({
    organizationId,
    plan,
  }: {
    organizationId: string;
    plan?: PlanInfo;
  }): Promise<UsageCount | "unlimited"> {
    // Skip the heavy ClickHouse query for unlimited plans (e.g. seat-based pricing).
    // The count would never exceed the limit, so querying is wasted work for
    // ENFORCEMENT. Returns "unlimited" so callers can distinguish from actual 0
    // usage. Display callers that need the real volume regardless of the cap use
    // getCurrentMonthCountForDisplay instead.
    const activePlan = plan ?? (await this.planResolver(organizationId));
    if (activePlan.maxMessagesPerMonth >= UNLIMITED_MESSAGES) {
      return "unlimited";
    }

    return this.computeCurrentMonthCount({ organizationId, plan: activePlan });
  }

  /**
   * Always computes the real current-month usage count (events or traces per the resolved
   * meter), regardless of whether the plan caps usage.
   */
  async getCurrentMonthCountForDisplay({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageCount> {
    return this.computeCurrentMonthCount({ organizationId });
  }

  private async computeCurrentMonthCount({
    organizationId,
    plan,
  }: {
    organizationId: string;
    plan?: PlanInfo;
  }): Promise<UsageCount> {
    const decision = await this.getCachedUsageMeterReading(organizationId, plan);
    const cacheKey = `${organizationId}:${decision.usageUnit}`;

    const cached = await this.countCache.findValue<number>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const projectIds = await this.organizations.getProjectIds(organizationId);
    if (projectIds.length === 0) {
      // A real measurement: an organization with no projects has sent nothing.
      return 0;
    }

    const counts = await this.countByProjects({
      decision,
      organizationId,
      projectIds,
    });
    if (counts === USAGE_UNKNOWN) {
      // Not cached. A cached unknown would outlive the outage that caused it
      // by the length of the TTL, which is exactly the trap the trace service
      // avoided by not caching its fail-open zero.
      return USAGE_UNKNOWN;
    }

    const total = counts.reduce((sum, c) => sum + c.count, 0);

    await this.countCache.set(cacheKey, total);

    return total;
  }

  /**
   * The month's count per project, counted once for a usage warning; "unlimited" where the
   * plan caps nothing, so no count is made.
   */
  async getCurrentMonthCountByProjects({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts | "unlimited"> {
    const plan = await this.planResolver(organizationId);
    if (plan.maxMessagesPerMonth >= UNLIMITED_MESSAGES) {
      return "unlimited";
    }

    return this.getCountByProjects({ organizationId, projectIds });
  }

  async getCountByProjects({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts> {
    if (projectIds.length === 0) {
      return [];
    }

    const decision = await this.getCachedUsageMeterReading(organizationId);

    return this.countByProjects({ decision, organizationId, projectIds });
  }

  private async countByProjects({
    decision,
    organizationId,
    projectIds,
  }: {
    decision: UsageMeterReading;
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts> {
    if (decision.usageUnit === "events") {
      return this.eventUsageService.getCountByProjects({
        organizationId,
        projectIds,
      });
    }

    return this.traceUsageService.getCountByProjects({
      organizationId,
      projectIds,
    });
  }

  private async getCachedUsageMeterReading(
    organizationId: string,
    plan?: PlanInfo,
  ): Promise<UsageMeterReading> {
    const cached = await this.decisionCache.findValue<UsageMeterReading>(organizationId);
    if (cached) {
      return cached;
    }

    const decision = await this.resolveUsageMeterReading(organizationId, plan);
    await this.decisionCache.set(organizationId, decision);

    return decision;
  }

  private async resolveUsageMeterReading(
    organizationId: string,
    resolvedPlan?: PlanInfo,
  ): Promise<UsageMeterReading> {
    const { pricingModel } = await this.organizations.getPricingModel(organizationId);
    const plan = resolvedPlan ?? (await this.planResolver(organizationId));
    const hasValidLicenseOverride = plan.planSource === "license";

    const decision = resolveUsageMeter({
      pricingModel,
      licenseUsageUnit: plan.usageUnit,
      hasValidLicenseOverride,
      isFree: plan.free,
    });

    return decision;
  }
}
