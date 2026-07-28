import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "~/server/db";
import { OrganizationRepository } from "~/server/repositories/organization.repository";
import { TtlCache } from "~/server/utils/ttlCache";
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
  ) {}

  static create(db: PrismaClient = prisma): TraceUsageService {
    return new TraceUsageService(new OrganizationRepository(db));
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
    const total = await queryTraceSummariesTotalUniq({
      projectIds,
      billingMonth,
    });

    if (total === null) {
      // queryTraceSummariesTotalUniq returns null only when no ClickHouse
      // client is available. Fail open (report 0), mirroring
      // event-usage.service.ts — but do NOT cache the failure-derived zero:
      // a cached 0 would keep license/limit enforcement reading "no usage"
      // for the full 5-minute TTL even after ClickHouse recovers.
      logger.warn(
        { organizationId, billingMonth },
        "getCurrentMonthCount: ClickHouse unavailable, returning 0 (fail-open, not cached)",
      );
      return 0;
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
  }): Promise<Array<{ projectId: string; count: number }>> {
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
    return Promise.all(
      projectIds.map(async (projectId) => {
        // null means ClickHouse is unavailable — fail open per-project with 0
        // (matching event-usage.service.ts); nothing is cached on this path.
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
