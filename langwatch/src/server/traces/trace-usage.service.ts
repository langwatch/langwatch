import type { PrismaClient } from "@prisma/client";
import { prisma } from "~/server/db";
import { OrganizationRepository } from "~/server/repositories/organization.repository";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import {
  getBillingMonth,
  queryTraceSummariesTotalUniq,
} from "../../../ee/billing/services/billableEventsQuery";

const logger = createLogger("langwatch:traces:traceUsage");

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const monthCountCache = new TtlCache<number>(
  CACHE_TTL_MS,
  "ttlcache:traceUsage:monthCount:",
);

export class TraceUsageService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly prisma: PrismaClient,
  ) {}

  static create(db: PrismaClient = prisma): TraceUsageService {
    return new TraceUsageService(new OrganizationRepository(db), db);
  }

  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    const billingMonth = getBillingMonth();
    const cacheKey = `${organizationId}:traces:${billingMonth}`;

    const cached = await monthCountCache.get(cacheKey);
    if (cached !== undefined) {
      logger.info(
        { organizationId, cached, billingMonth },
        "getCurrentMonthCount: cache hit",
      );
      return cached;
    }

    const projectIds =
      await this.organizationRepository.getProjectIds(organizationId);
    logger.info(
      { organizationId, projectIds },
      "getCurrentMonthCount: querying trace_summaries",
    );
    const total =
      (await queryTraceSummariesTotalUniq({ projectIds, billingMonth })) ?? 0;

    await monthCountCache.set(cacheKey, total);
    return total;
  }

  async getCountByProjects({
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<Array<{ projectId: string; count: number }>> {
    if (projectIds.length === 0) return [];

    const billingMonth = getBillingMonth();
    return Promise.all(
      projectIds.map(async (projectId) => {
        const count =
          (await queryTraceSummariesTotalUniq({
            projectIds: [projectId],
            billingMonth,
          })) ?? 0;
        return { projectId, count };
      }),
    );
  }
}
