import { createLogger } from "@langwatch/observability";
import { UNLIMITED_MESSAGES } from "../../../../ee/billing/planLimits";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import type { OrganizationRepository } from "../../repositories/organization.repository";
import type { EventUsageService } from "../../traces/event-usage.service";
import type { TraceUsageService } from "../../traces/trace-usage.service";
import {
  type ProjectUsageCounts,
  USAGE_UNKNOWN,
  type UsageCount,
} from "../../traces/usage-count";
import { TtlCache } from "../../utils/ttlCache";
import { OrganizationNotFoundForTeamError } from "../organizations/errors";
import type { OrganizationService } from "../organizations/organization.service";
import type { SimulationRunService } from "../simulations/simulation-run.service";
import type { PlanResolver } from "../subscription/plan-provider";
import { ScenarioSetLimitExceededError } from "./errors";
import { buildLimitMessage } from "./limit-message";

const logger = createLogger("langwatch:usage");

import {
  type MeterDecision,
  resolveUsageMeter,
  type UsageUnit,
} from "./usage-meter-policy";

const CACHE_TTL_MS = 30_000; // 30 seconds
const MAX_FREE_SCENARIO_SETS = 3;

export interface UsageLimitResult {
  exceeded: boolean;
  message?: string;
  count?: number;
  maxMessagesPerMonth?: number;
  planName?: string;
}

/**
 * App-layer usage service.
 *
 * Orchestrates: plan → meter policy → counter.
 * The meter policy resolves the counting unit (traces/events).
 * Counting execution is delegated to TraceUsageService or
 * EventUsageService depending on the resolved meter.
 */
export class UsageService {
  private readonly countCache: TtlCache<number>;
  private readonly decisionCache: TtlCache<MeterDecision>;
  private readonly scenarioSetCache: TtlCache<string[]>;

  constructor(
    private readonly organizationService: OrganizationService,
    private readonly traceUsageService: TraceUsageService,
    private readonly eventUsageService: EventUsageService,
    private readonly planResolver: PlanResolver,
    private readonly organizationRepository: OrganizationRepository | null,
    private readonly simulationRunService: Pick<
      SimulationRunService,
      "getDistinctExternalSetIds"
    >,
  ) {
    this.countCache = new TtlCache<number>(
      CACHE_TTL_MS,
      "ttlcache:usage:count:",
    );
    this.decisionCache = new TtlCache<MeterDecision>(
      CACHE_TTL_MS,
      "ttlcache:usage:decision:",
    );
    this.scenarioSetCache = new TtlCache<string[]>(
      CACHE_TTL_MS,
      "ttlcache:usage:scenarioSets:",
    );
  }

  async checkLimit({ teamId }: { teamId: string }): Promise<UsageLimitResult> {
    const organizationId =
      await this.organizationService.getOrganizationIdByTeamId(teamId);
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
      const decision = await this.getCachedMeterDecision(organizationId, plan);
      return {
        exceeded: true,
        message: buildLimitMessage({
          isFree: plan.free,
          limit: plan.maxMessagesPerMonth,
          usageUnit: decision.usageUnit,
        }),
        count,
        maxMessagesPerMonth: plan.maxMessagesPerMonth,
        planName: plan.name,
      };
    }
    return { exceeded: false };
  }

  /**
   * Checks whether the organization may use the given scenario set ID.
   *
   * Known sets (cached) are allowed immediately. Unknown sets trigger a
   * query via the simulation service to count distinct external scenario
   * sets across all org projects. If the count is at or above the plan
   * limit and the set is new, throws ScenarioSetLimitExceededError.
   */
  async checkScenarioSetLimit({
    organizationId,
    scenarioSetId,
  }: {
    organizationId: string;
    scenarioSetId: string;
  }): Promise<void> {
    // Fast path: set is already known from a recent check
    const cachedArr = await this.scenarioSetCache.get(organizationId);
    if (cachedArr?.includes(scenarioSetId)) {
      return;
    }

    const plan = await this.planResolver(organizationId);
    const maxScenarioSets =
      plan.free && !plan.overrideAddingLimitations
        ? MAX_FREE_SCENARIO_SETS
        : Infinity;

    // Use cached array for counting if available; only query ClickHouse on cold start.
    // This prevents the async event-sourcing delay from resetting the count:
    // events are written to ClickHouse asynchronously, so a fresh query may
    // return stale data and overwrite sets we already know about.
    let knownSetIds: string[];
    if (cachedArr) {
      knownSetIds = cachedArr;
    } else {
      const projectIds =
        await this.organizationService.getProjectIds(organizationId);
      if (projectIds.length === 0) {
        await this.scenarioSetCache.set(organizationId, [scenarioSetId]);
        return;
      }

      const fromService =
        await this.simulationRunService.getDistinctExternalSetIds({
          projectIds,
        });
      knownSetIds = [...fromService];
      await this.scenarioSetCache.set(organizationId, knownSetIds);
    }

    // If this set already exists, allow
    if (knownSetIds.includes(scenarioSetId)) {
      return;
    }

    // This is a new set -- check against limit
    if (knownSetIds.length >= maxScenarioSets) {
      throw new ScenarioSetLimitExceededError(
        knownSetIds.length,
        maxScenarioSets,
      );
    }

    // Allowed: record the new set in the cache
    knownSetIds.push(scenarioSetId);
    await this.scenarioSetCache.set(organizationId, knownSetIds);
  }

  /**
   * Returns the resolved usage unit for the given organization.
   * Delegates to the cached meter decision.
   */
  async getResolvedUsageUnit({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageUnit> {
    const decision = await this.getCachedMeterDecision(organizationId);
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
    const decision = await this.getCachedMeterDecision(organizationId, plan);
    const cacheKey = `${organizationId}:${decision.usageUnit}`;

    const cached = await this.countCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const projectIds =
      await this.organizationService.getProjectIds(organizationId);
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

    const decision = await this.getCachedMeterDecision(organizationId);
    return this.countByProjects({ decision, organizationId, projectIds });
  }

  private async countByProjects({
    decision,
    organizationId,
    projectIds,
  }: {
    decision: MeterDecision;
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

  private async getCachedMeterDecision(
    organizationId: string,
    plan?: PlanInfo,
  ): Promise<MeterDecision> {
    const cached = await this.decisionCache.get(organizationId);
    if (cached) return cached;

    const decision = await this.resolveMeterDecision(organizationId, plan);
    await this.decisionCache.set(organizationId, decision);
    return decision;
  }

  private async resolveMeterDecision(
    organizationId: string,
    resolvedPlan?: PlanInfo,
  ): Promise<MeterDecision> {
    const pricingModel =
      (await this.organizationRepository?.getPricingModel(organizationId)) ??
      null;
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
