import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import type { ClickHouseClient } from "@clickhouse/client";
import { FREE_PLAN } from "../../../ee/licensing/constants";
import type { PrismaClient } from "@prisma/client";
import { env } from "~/env.mjs";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma } from "~/server/db";
import {
  esClient as defaultEsClient,
  TRACE_INDEX,
} from "~/server/elasticsearch";
import { OrganizationRepository } from "~/server/repositories/organization.repository";
import { getCurrentMonthStartMs } from "~/server/utils/dateUtils";
import { TtlCache } from "~/server/utils/ttlCache";
import {
  queryBillableEventsTotalApprox,
  queryBillableEventsByProjectApprox,
  getBillingMonth,
} from "../../../ee/billing/services/billableEventsQuery";

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
    private readonly prisma: PrismaClient,
    private readonly clickHouseClient: ClickHouseClient | null,
  ) {}

  /**
   * Static factory method for creating TraceUsageService with proper DI
   */
  static create(db: PrismaClient = prisma): TraceUsageService {
    return new TraceUsageService(
      new OrganizationRepository(db),
      defaultEsClient,
      SubscriptionHandler,
      db,
      getClickHouseClient(),
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
   * Gets current month trace count for an organization (cached for 5 minutes).
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

    // SaaS: deduplicated billable events from ClickHouse, null when not configured
    // ClickHouse is configured in Cloud environment
    const totalEvents = await this.getBillableEventsMonthCount({ organizationId });
    if (totalEvents !== null) {
      monthCountCache.set(organizationId, totalEvents);
      return totalEvents;
    }

    // Self-hosted fallback: raw trace count from ES
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
   * Gets current month trace count per project.
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

    // SaaS: deduplicated billable events per project from ClickHouse
    const eventCounts = await this.getBillableEventsCountByProjects({
      organizationId,
      projectIds,
    });
    if (eventCounts !== null) {
      return eventCounts;
    }

    // Self-hosted fallback: route by per-project CH feature flag
    const monthStart = getCurrentMonthStartMs();

    const { chProjectIds, esProjectIds } =
      await this.splitProjectsByFlag(projectIds);

    const [chResults, esResults] = await Promise.all([
      chProjectIds.length > 0
        ? this.getCountsFromClickHouse(chProjectIds, monthStart)
        : [],
      esProjectIds.length > 0
        ? this.getCountsFromElasticsearch(
            organizationId,
            esProjectIds,
            monthStart,
          )
        : [],
    ]);

    return [...chResults, ...esResults];
  }

  private async splitProjectsByFlag(
    projectIds: string[],
  ): Promise<{ chProjectIds: string[]; esProjectIds: string[] }> {
    if (!this.clickHouseClient) {
      return { chProjectIds: [], esProjectIds: projectIds };
    }

    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, featureClickHouseDataSourceTraces: true },
    });

    const flagMap = new Map(
      projects.map((p) => [p.id, p.featureClickHouseDataSourceTraces]),
    );

    const chProjectIds: string[] = [];
    const esProjectIds: string[] = [];

    for (const id of projectIds) {
      if (flagMap.get(id)) {
        chProjectIds.push(id);
      } else {
        esProjectIds.push(id);
      }
    }

    return { chProjectIds, esProjectIds };
  }

  private async getCountsFromClickHouse(
    projectIds: string[],
    monthStart: number,
  ): Promise<Array<{ projectId: string; count: number }>> {
    const result = await this.clickHouseClient!.query({
      query: `
        SELECT TenantId, toString(count(DISTINCT TraceId)) AS Total
        FROM trace_summaries FINAL
        WHERE TenantId IN ({projectIds:Array(String)})
          AND CreatedAt >= fromUnixTimestamp64Milli({monthStart:UInt64})
        GROUP BY TenantId
      `,
      query_params: {
        projectIds,
        monthStart,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      TenantId: string;
      Total: string;
    }>;

    const countMap = new Map(
      rows.map((r) => [r.TenantId, parseInt(r.Total, 10)]),
    );

    return projectIds.map((id) => ({
      projectId: id,
      count: countMap.get(id) ?? 0,
    }));
  }

  private async getCountsFromElasticsearch(
    organizationId: string,
    projectIds: string[],
    monthStart: number,
  ): Promise<Array<{ projectId: string; count: number }>> {
    const esClient = await this.esClientFactory({ organizationId });
    const results: Array<{ projectId: string; count: number }> = [];

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

  /**
   * Returns approximate billable event count for the current UTC month
   * using HyperLogLog (~1% error), or null if ClickHouse is not configured.
   */
  private async getBillableEventsMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    if (!getClickHouseClient()) return null;

    const billingMonth = getBillingMonth();
    return (
      (await queryBillableEventsTotalApprox({ organizationId, billingMonth })) ??
      0
    );
  }

  /**
   * Returns approximate per-project billable event counts for the current UTC
   * billing month using HyperLogLog (~1% error), or null if ClickHouse is not configured.
   */
  private async getBillableEventsCountByProjects({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<Array<{ projectId: string; count: number }> | null> {
    if (!getClickHouseClient()) return null;

    const billingMonth = getBillingMonth();
    const counts = await queryBillableEventsByProjectApprox({
      organizationId,
      billingMonth,
    });
    const countsMap = new Map(counts.map((c) => [c.projectId, c.count]));
    return projectIds.map((pid) => ({
      projectId: pid,
      count: countsMap.get(pid) ?? 0,
    }));
  }
}
