import { TraceUsageService } from "../../traces/trace-usage.service";
import { EventUsageService } from "../../traces/event-usage.service";
import type { PlanResolver } from "../subscription/plan-provider";
import { TtlCache } from "../../utils/ttlCache";
import { OrganizationNotFoundForTeamError } from "../organizations/errors";
import type { OrganizationService } from "../organizations/organization.service";
import {
  resolveUsageMeter,
  type MeterDecision,
  type UsageUnit,
} from "./usage-meter-policy";
import { OrganizationRepository } from "../../repositories/organization.repository";
import { getClickHouseClient } from "../../clickhouse/client";
import { INTERNAL_SET_PREFIX } from "../../scenarios/internal-set-id";
import { env } from "~/env.mjs";
import { ScenarioSetLimitExceededError } from "./errors";

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
 * The meter policy resolves the counting unit (traces/events) and backend
 * (ClickHouse/ElasticSearch). Counting execution is delegated to
 * TraceUsageService or EventUsageService depending on the resolved meter.
 */
export class UsageService {
  private readonly cache: TtlCache<number>;
  private readonly decisionCache: TtlCache<MeterDecision>;
  private readonly scenarioSetCache: TtlCache<Set<string>>;

  constructor(
    private readonly organizationService: OrganizationService,
    private readonly traceUsageService: TraceUsageService,
    private readonly eventUsageService: EventUsageService,
    private readonly planResolver: PlanResolver,
    private readonly organizationRepository: OrganizationRepository | null,
  ) {
    this.cache = new TtlCache<number>(CACHE_TTL_MS);
    this.decisionCache = new TtlCache<MeterDecision>(CACHE_TTL_MS);
    this.scenarioSetCache = new TtlCache<Set<string>>(CACHE_TTL_MS);
  }

  async checkLimit({ teamId }: { teamId: string }): Promise<UsageLimitResult> {
    const organizationId =
      await this.organizationService.getOrganizationIdByTeamId(teamId);
    if (!organizationId) {
      throw new OrganizationNotFoundForTeamError(teamId);
    }

    const [count, plan] = await Promise.all([
      this.getCurrentMonthCount({ organizationId }),
      this.planResolver(organizationId),
    ]);

    if (count >= plan.maxMessagesPerMonth) {
      // getCurrentMonthCount already warmed the decision cache, so this is a map lookup
      const decision = await this.getCachedMeterDecision(organizationId);
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
   * ClickHouse query to count distinct external scenario sets across all
   * org projects. If the count is at or above the plan limit and the set
   * is new, throws ScenarioSetLimitExceededError.
   */
  async checkScenarioSetLimit({
    organizationId,
    scenarioSetId,
  }: {
    organizationId: string;
    scenarioSetId: string;
  }): Promise<void> {
    // Fast path: set is already known from a recent check
    const cached = this.scenarioSetCache.get(organizationId);
    if (cached?.has(scenarioSetId)) {
      return;
    }

    const plan = await this.planResolver(organizationId);
    const maxScenarioSets =
      plan.free && !plan.overrideAddingLimitations
        ? MAX_FREE_SCENARIO_SETS
        : Infinity;

    // If no cache, query ClickHouse for distinct external sets
    const projectIds =
      await this.organizationService.getProjectIds(organizationId);
    if (projectIds.length === 0) {
      // No projects means no existing sets -- allow and warm cache
      const newSet = new Set([scenarioSetId]);
      this.scenarioSetCache.set(organizationId, newSet);
      return;
    }

    const existingSets =
      await this.queryDistinctExternalScenarioSets(projectIds);

    // Populate cache with the fetched sets
    this.scenarioSetCache.set(organizationId, existingSets);

    // If this set already exists in ClickHouse, allow
    if (existingSets.has(scenarioSetId)) {
      return;
    }

    // This is a new set -- check against limit
    if (existingSets.size >= maxScenarioSets) {
      throw new ScenarioSetLimitExceededError(existingSets.size, maxScenarioSets);
    }

    // Allowed: record the new set in the cache
    existingSets.add(scenarioSetId);
  }

  /**
   * Queries ClickHouse for distinct external (non-internal) scenario set IDs
   * across the given project IDs.
   *
   * Overridable for testing via Object.assign on the prototype.
   */
  protected async queryDistinctExternalScenarioSets(
    projectIds: string[],
  ): Promise<Set<string>> {
    const client = getClickHouseClient();
    if (!client) {
      return new Set();
    }

    const result = await client.query({
      query: `
        SELECT DISTINCT ScenarioSetId
        FROM (
          SELECT ScenarioSetId, ArchivedAt
          FROM simulation_runs
          WHERE TenantId IN ({projectIds:Array(String)})
            AND NOT startsWith(ScenarioSetId, '${INTERNAL_SET_PREFIX}')
          ORDER BY ScenarioRunId, UpdatedAt DESC
          LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
        )
        WHERE ArchivedAt IS NULL
      `,
      query_params: { projectIds },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ ScenarioSetId: string }>();
    return new Set(rows.map((r) => r.ScenarioSetId));
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
  }: {
    organizationId: string;
  }): Promise<number> {
    const decision = await this.getCachedMeterDecision(organizationId);
    const cacheKey = `${organizationId}:${decision.usageUnit}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const projectIds =
      await this.organizationService.getProjectIds(organizationId);
    if (projectIds.length === 0) {
      return 0;
    }

    const counts = await this.countByProjects({
      decision,
      organizationId,
      projectIds,
    });
    const total = counts.reduce((sum, c) => sum + c.count, 0);

    this.cache.set(cacheKey, total);
    return total;
  }

  async getCountByProjects({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<Array<{ projectId: string; count: number }>> {
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
  }): Promise<Array<{ projectId: string; count: number }>> {
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
  ): Promise<MeterDecision> {
    const cached = this.decisionCache.get(organizationId);
    if (cached) return cached;

    const decision = await this.resolveMeterDecision(organizationId);
    this.decisionCache.set(organizationId, decision);
    return decision;
  }

  private async resolveMeterDecision(
    organizationId: string,
  ): Promise<MeterDecision> {
    const pricingModel =
      (await this.organizationRepository?.getPricingModel(organizationId)) ??
      null;
    const plan = await this.planResolver(organizationId);
    const hasValidLicenseOverride = plan.planSource === "license";

    const decision = resolveUsageMeter({
      pricingModel,
      licenseUsageUnit: plan.usageUnit,
      hasValidLicenseOverride,
      isFree: plan.free,
      clickhouseAvailable: !!getClickHouseClient(),
    });

    return decision;
  }

  /** Clears the internal cache (for testing). */
  clearCache(): void {
    this.cache.clear();
    this.decisionCache.clear();
    this.scenarioSetCache.clear();
  }
}

/**
 * Builds the human-readable limit message for 429 responses.
 *
 * Format: "{prefix} limit of {limit} {unit} reached. To increase your limits, {action}"
 * - prefix: "Free" for free-tier orgs, "Monthly" for paid orgs
 * - unit: "events" or "traces" based on the meter decision
 * - action: SaaS users are told to upgrade; self-hosted users are told to buy a license
 */
function buildLimitMessage({
  isFree,
  limit,
  usageUnit,
}: {
  isFree: boolean;
  limit: number;
  usageUnit: UsageUnit;
}): string {
  const prefix = isFree ? "Free" : "Monthly";
  const base = `${prefix} limit of ${limit} ${usageUnit} reached`;
  const upgradeUrl = buildUpgradeUrl();

  return `${base}. To increase your limits, ${upgradeUrl}`;
}

/**
 * Returns the upgrade call-to-action based on deployment mode.
 * SaaS: "upgrade your plan at https://app.langwatch.ai/settings/subscription"
 * Self-hosted: "buy a license at {BASE_HOST}/settings/license"
 */
function buildUpgradeUrl(): string {
  if (env.IS_SAAS) {
    return "upgrade your plan at https://app.langwatch.ai/settings/subscription";
  }

  const baseHost = env.BASE_HOST ?? "https://app.langwatch.ai";
  return `buy a license at ${baseHost}/settings/license`;
}
