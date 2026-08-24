import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { OrganizationRepository } from "~/server/repositories/organization.repository";
import { TtlCache } from "~/server/utils/ttlCache";
import { getBillingMonth } from "~/runtime/app/features/billing";
import { getApp } from "~/server/app-layer/app";
import {
  type ProjectUsageCounts,
  USAGE_UNKNOWN,
  type UsageCount,
} from "./usage-count";

const logger = createLogger("langwatch:traces:traceUsage");

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const monthCountCache = new TtlCache<number>(
  CACHE_TTL_MS,
  "ttlcache:traceUsage:monthCount:",
);

export class TraceUsageService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  static create(db: PrismaClient = prisma): TraceUsageService {
    return new TraceUsageService(new OrganizationRepository(db));
  }

  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageCount> {
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
    const total = await getApp().billingQueries.queryTraceSummariesTotalUniq({
      projectIds,
      billingMonth,
    });

    if (total === null) {
      // queryTraceSummariesTotalUniq returns null only when no ClickHouse
      // client is available — the count is unknown, which is not the same
      // fact as zero and must not be reported as one. Nothing is cached
      // either way: caching an unknown would make a five-minute TTL out of a
      // condition that may clear on the next call.
      logger.warn(
        { organizationId, billingMonth },
        "getCurrentMonthCount: ClickHouse unavailable, usage is unknown",
      );
      return USAGE_UNKNOWN;
    }

    await monthCountCache.set(cacheKey, total);
    return total;
  }

  async getCountByProjects({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts> {
    if (projectIds.length === 0) return [];

    // The signature advertises organization scoping — enforce it. Current
    // callers derive projectIds from the organization already, so a foreign
    // id here is a programming error (or attacker-influenced input) and must
    // not read another tenant's trace counts.
    const organizationProjectIds = new Set(
      await this.organizationRepository.getProjectIds(organizationId),
    );
    const foreignProjectIds = projectIds.filter(
      (projectId) => !organizationProjectIds.has(projectId),
    );
    if (foreignProjectIds.length > 0) {
      throw new Error(
        `getCountByProjects: projectIds [${foreignProjectIds.join(", ")}] do not belong to organization ${organizationId}`,
      );
    }

    const billingMonth = getBillingMonth();
    const counts = await Promise.all(
      projectIds.map(async (projectId) => ({
        projectId,
        // null means ClickHouse is unavailable, so this project's count is
        // unknown rather than zero.
        count: await getApp().billingQueries.queryTraceSummariesTotalUniq({
          projectIds: [projectId],
          billingMonth,
        }),
      })),
    );

    // One unreachable project makes the whole set untrustworthy: a caller
    // comparing projects, or summing them against a cap, would silently be
    // working from a partial total. Better to say the answer is unknown than
    // to hand back a set that looks complete and is not.
    if (counts.some(({ count }) => count === null || count === undefined)) {
      logger.warn(
        { organizationId, billingMonth },
        "getCountByProjects: ClickHouse unavailable, usage is unknown",
      );
      return USAGE_UNKNOWN;
    }

    return counts.map(({ projectId, count }) => ({
      projectId,
      count: count as number,
    }));
  }
}
