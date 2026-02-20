import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { FREE_PLAN } from "../../../ee/licensing/constants";
import type { PrismaClient } from "@prisma/client";
import { env } from "~/env.mjs";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { prisma } from "~/server/db";
import {
  esClient as defaultEsClient,
  TRACE_INDEX,
} from "~/server/elasticsearch";
import { OrganizationRepository } from "~/server/repositories/organization.repository";
import { getCurrentMonthStartMs } from "~/server/utils/dateUtils";
import { TtlCache } from "~/server/utils/ttlCache";

type EsClientFactory = typeof defaultEsClient;

const BATCH_SIZE = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Module-level cache for getCurrentMonthCount */
const monthCountCache = new TtlCache<number>(CACHE_TTL_MS);

/** Clear cache (for testing) */
export const clearMonthCountCache = (): void => {
  monthCountCache.clear();
};

/**
 * Service for trace usage tracking and limit enforcement
 */
export class TraceUsageService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly esClientFactory: EsClientFactory,
    private readonly subscriptionHandler: typeof SubscriptionHandler,
  ) {}

  /**
   * Static factory method for creating TraceUsageService with proper DI
   */
  static create(db: PrismaClient = prisma): TraceUsageService {
    return new TraceUsageService(
      new OrganizationRepository(db),
      defaultEsClient,
      SubscriptionHandler,
    );
  }

  /**
   * Checks if team's organization has exceeded trace limit
   */
  async checkLimit({ teamId }: { teamId: string }): Promise<{
    exceeded: boolean;
    message?: string;
    count?: number;
    maxMessagesPerMonth?: number;
    planName?: string;
  }> {

    const organizationId =
      await this.organizationRepository.getOrganizationIdByTeamId(teamId);
    if (!organizationId) {
      throw new Error(`Team ${teamId} has no organization`);
    }

    const [count, plan] = await Promise.all([
      this.getCurrentMonthCount({ organizationId }),
      this.subscriptionHandler.getActivePlan(organizationId),
    ]);

    // Self-hosted = unlimited traces
    // Preventing customers from getting blocked when no license is active
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

  /**
   * Gets current month trace count for an organization (cached for 5 minutes)
   */
  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    const cached = monthCountCache.get(organizationId);
    if (cached !== undefined) {
      return cached;
    }

    const projectIds =
      await this.organizationRepository.getProjectIds(organizationId);
    if (projectIds.length === 0) {
      return 0;
    }

    const counts = await this.getCountByProjects({
      organizationId,
      projectIds,
    });
    const total = counts.reduce((sum, c) => sum + c.count, 0);

    monthCountCache.set(organizationId, total);
    return total;
  }

  /**
   * Gets current month trace count per project (batched for concurrency control)
   */
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

    const esClient = await this.esClientFactory({ organizationId });
    const monthStart = getCurrentMonthStartMs();
    const results: Array<{ projectId: string; count: number }> = [];

    // Process in batches to avoid overwhelming ES
    for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
      const batch = projectIds.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (projectId) => {
          const result = await esClient.count({
            index: TRACE_INDEX.alias,
            body: {
              query: {
                bool: {
                  must: [
                    { term: { project_id: projectId } },
                    {
                      range: {
                        "timestamps.inserted_at": { gte: monthStart },
                      },
                    },
                  ] as QueryDslBoolQuery["filter"],
                } as QueryDslBoolQuery,
              },
            },
          });
          return { projectId, count: result.count };
        }),
      );

      results.push(...batchResults);
    }

    return results;
  }
}
