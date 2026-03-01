import type { PrismaClient } from "@prisma/client";
import { getApp } from "~/server/app-layer";
import { FREE_PLAN } from "../../../../ee/licensing/constants";
import { env } from "../../../env.mjs";
import { TraceUsageService } from "../../traces/trace-usage.service";
import { EventUsageService } from "../../traces/event-usage.service";
import type { PlanResolver } from "../subscription/plan-provider";
import { TtlCache } from "../../utils/ttlCache";
import { OrganizationNotFoundForTeamError } from "../organizations/errors";
import type { OrganizationService } from "../organizations/organization.service";
import { resolveUsageMeter, type MeterDecision } from "./usage-meter-policy";
import { OrganizationRepository } from "../../repositories/organization.repository";
import { getClickHouseClient } from "../../clickhouse/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:usage:usageService");

const CACHE_TTL_MS = 30_000; // 30 seconds

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
 * TraceUsageService.
 */
export class UsageService {
  private readonly cache: TtlCache<number>;

  private constructor(
    private readonly organizationService: OrganizationService,
    private readonly traceUsageService: TraceUsageService,
    private readonly eventUsageService: EventUsageService,
    private readonly planResolver: PlanResolver,
    private readonly organizationRepository: OrganizationRepository,
  ) {
    this.cache = new TtlCache<number>(CACHE_TTL_MS);
  }

  static create({
    prisma,
    organizationService,
    planResolver,
  }: {
    prisma: PrismaClient | null;
    organizationService: OrganizationService;
    planResolver?: PlanResolver;
  }): UsageService {
    const traceUsageService = prisma
      ? TraceUsageService.create(prisma)
      : TraceUsageService.create();
    const eventUsageService = new EventUsageService();
    const resolver: PlanResolver =
      planResolver ??
      ((organizationId) =>
        getApp().planProvider.getActivePlan({ organizationId }));
    const orgRepo = new OrganizationRepository(
      prisma ?? (undefined as unknown as PrismaClient),
    );
    return new UsageService(
      organizationService,
      traceUsageService,
      eventUsageService,
      resolver,
      orgRepo,
    );
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

    // Self-hosted = unlimited traces
    // Preventing customers from getting blocked when no license is active
    if (!env.IS_SAAS && plan.type === FREE_PLAN.type) {
      return { exceeded: false };
    }

    if (count >= plan.maxMessagesPerMonth) {
      return {
        exceeded: true,
        message: `Monthly limit of ${plan.maxMessagesPerMonth} traces reached`,
        count,
        maxMessagesPerMonth: plan.maxMessagesPerMonth,
        planName: plan.name,
      };
    }
    return { exceeded: false };
  }

  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    const decision = await this.resolveMeterDecision(organizationId);
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

    const decision = await this.resolveMeterDecision(organizationId);
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

  private async resolveMeterDecision(
    organizationId: string,
  ): Promise<MeterDecision> {
    const pricingModel =
      await this.organizationRepository.getPricingModel(organizationId);
    const plan = await this.planResolver(organizationId);
    const hasValidLicenseOverride = !plan.free;

    const decision = resolveUsageMeter({
      pricingModel,
      licenseUsageUnit: plan.usageUnit,
      hasValidLicenseOverride,
      clickhouseAvailable: !!getClickHouseClient(),
    });

    logger.info(
      { organizationId, ...decision },
      "resolved meter decision",
    );

    return decision;
  }

  /** Clears the internal cache (for testing). */
  clearCache(): void {
    this.cache.clear();
  }
}
