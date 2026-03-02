import type { PrismaClient } from "@prisma/client";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { FREE_PLAN } from "../../../../ee/licensing/constants";
import { env } from "../../../env.mjs";
import { TraceUsageService } from "../../traces/trace-usage.service";
import { TtlCache } from "../../utils/ttlCache";
import { OrganizationNotFoundForTeamError } from "../organizations/errors";
import type { OrganizationService } from "../organizations/organization.service";

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
 * Delegates usage counting to TraceUsageService (ES/CH).
 */
export class UsageService {
  private readonly cache: TtlCache<number>;

  private constructor(
    private readonly organizationService: OrganizationService,
    private readonly esTraceUsageService: TraceUsageService,
    private readonly subscriptionHandler: typeof SubscriptionHandler,
  ) {
    this.cache = new TtlCache<number>(CACHE_TTL_MS);
  }

  static create({
    prisma,
    organizationService,
    subscriptionHandler = SubscriptionHandler,
  }: {
    prisma: PrismaClient | null;
    organizationService: OrganizationService;
    subscriptionHandler?: typeof SubscriptionHandler;
  }): UsageService {
    const esTraceUsageService = prisma
      ? TraceUsageService.create(prisma)
      : TraceUsageService.create();
    return new UsageService(
      organizationService,
      esTraceUsageService,
      subscriptionHandler,
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
      this.subscriptionHandler.getActivePlan(organizationId),
    ]);

    // Self-hosted = unlimited traces
    if (!env.IS_SAAS && plan === FREE_PLAN) {
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
    const cached = this.cache.get(organizationId);
    if (cached !== undefined) {
      return cached;
    }

    const projectIds =
      await this.organizationService.getProjectIds(organizationId);
    if (projectIds.length === 0) {
      return 0;
    }

    const counts = await this.esTraceUsageService.getCountByProjects({
      organizationId,
      projectIds,
    });
    const total = counts.reduce((sum, c) => sum + c.count, 0);

    this.cache.set(organizationId, total);
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

    return this.esTraceUsageService.getCountByProjects({
      organizationId,
      projectIds,
    });
  }

  /** Clears the internal cache (for testing). */
  clearCache(): void {
    this.cache.clear();
  }
}
