import { createLogger } from "@langwatch/observability";
import type { PlanInfo, UsageUnit } from "@langwatch/entitlement-contract";
import { USAGE_UNKNOWN, type UsageCount } from "../ports/usage-counter.port";
import {
  NoUsageCache,
  type ProjectUsageCounts,
  type UsageCachePort,
  type UsageMeterReading,
  type UsageOrganizationPort,
  type UsageVolumeCounterPort,
} from "../ports/usage-enforcement.ports";
import { resolveUsageMeter } from "./usage-meter-policy.service";
import { buildLimitMessage, type UsageDeployment } from "./usage-limit-message.service";

const logger = createLogger("langwatch:usage");

/**
 * The allowance a plan states when it means "we do not cap this".
 *
 * Stated rather than imported from the Enterprise billing contract, which a
 * core package may not reach into — the same call `usage-stats.service.ts`
 * already makes for the same sentinel.
 */
const UNLIMITED_MESSAGES = 999_999_999;

/** A plan resolved for one organization. */
export type PlanResolver = (organizationId: string) => Promise<PlanInfo>;

/**
 * No organization owns the team the caller named.
 *
 * A refusal rather than an allowance: enforcement was asked about a tenant
 * that does not resolve, and answering "within limits" would meter traffic
 * against nobody's plan.
 */
export class OrganizationNotFoundForTeamError extends Error {
  constructor(teamId: string) {
    super(`No organization found for team ${teamId}`);
    this.name = "OrganizationNotFoundForTeamError";
  }
}

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

/**
 * App-layer usage service.
 *
 * Orchestrates: plan → meter policy → counter.
 * The meter policy resolves the counting unit (traces/events).
 * Counting execution is delegated to TraceUsageService or
 * EventUsageService depending on the resolved meter.
 */
export class UsageService {
  private readonly organizations: UsageOrganizationPort;
  private readonly traceUsageService: UsageVolumeCounterPort;
  private readonly eventUsageService: UsageVolumeCounterPort;
  private readonly planResolver: PlanResolver;
  private readonly deployment: UsageDeployment;
  private readonly countCache: UsageCachePort;
  private readonly decisionCache: UsageCachePort;

  constructor(deps: {
    organizations: UsageOrganizationPort;
    traceCounter: UsageVolumeCounterPort;
    eventCounter: UsageVolumeCounterPort;
    planResolver: PlanResolver;
    deployment: UsageDeployment;
    /** Both caches are 30-second windows in production; absent means uncached. */
    countCache?: UsageCachePort;
    decisionCache?: UsageCachePort;
  }) {
    this.organizations = deps.organizations;
    this.traceUsageService = deps.traceCounter;
    this.eventUsageService = deps.eventCounter;
    this.planResolver = deps.planResolver;
    this.deployment = deps.deployment;
    this.countCache = deps.countCache ?? new NoUsageCache();
    this.decisionCache = deps.decisionCache ?? new NoUsageCache();
  }

  async checkLimit({ teamId }: { teamId: string }): Promise<UsageLimitResult> {
    const organizationId = await this.organizations.tryGetOrganizationIdByTeamId({ teamId });
    if (!organizationId) {
      throw new OrganizationNotFoundForTeamError(teamId);
    }

    const plan = await this.planResolver(organizationId);
    const count = await this.getCurrentMonthCount({ organizationId, plan });

    if (count === "unlimited") {
      return { exceeded: false };
    }

    if (count === USAGE_UNKNOWN) {
      // Deliberately permissive, and deliberately loud. Enforcement cannot say
      // whether this organization is over its cap, and locking a paying
      // customer out of their own product because OUR counting store is down
      // is the worse of the two errors — so traffic continues.
      //
      // What changed is that the decision is now made HERE, once, by the code
      // that owns enforcement, instead of arriving pre-made as a `0` from a
      // counting service that had no idea it was granting anyone anything. It
      // is logged at warn so a metering outage is visible as a metering
      // outage, rather than showing up as a suspiciously quiet month.
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
   * Always computes the real current-month usage count (events or traces per
   * the resolved meter), regardless of whether the plan caps usage.
   *
   * Seat-based / metered plans (GROWTH_SEAT_*) have no monthly message cap but
   * still accrue billable events that are metered and billed via Stripe. The
   * usage page must surface that volume, so it cannot use getCurrentMonthCount
   * (which short-circuits unlimited plans to "unlimited" for enforcement and
   * would otherwise render as "0").
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

    const cached = await this.countCache.get<number>(cacheKey);
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
    const cached = await this.decisionCache.get<UsageMeterReading>(organizationId);
    if (cached) return cached;

    const decision = await this.resolveUsageMeterReading(organizationId, plan);
    await this.decisionCache.set(organizationId, decision);
    return decision;
  }

  private async resolveUsageMeterReading(
    organizationId: string,
    resolvedPlan?: PlanInfo,
  ): Promise<UsageMeterReading> {
    const pricingModel = await this.organizations.tryGetPricingModel(organizationId);
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
