import { createLogger } from "@langwatch/observability";
import { isClickHouseEnabled } from "~/server/app-layer/clients/clickhouse/shared";
import {
  getBillingMonth,
  queryBillableEventsByProjectApprox,
  queryBillableEventsTotalUniq,
} from "../../../ee/billing/services/billableEventsQuery";
import {
  type ProjectUsageCounts,
  USAGE_UNKNOWN,
  type UsageCount,
} from "./usage-count";

const logger = createLogger("langwatch:traces:eventUsage");

/**
 * Events-only counting execution service.
 *
 * Queries the ClickHouse `billable_events` table for event counts.
 *
 * Answers {@link USAGE_UNKNOWN} — never 0 — when it cannot count. A zero here
 * is a real measurement that callers act on; see `usage-count.ts`.
 */
export class EventUsageService {
  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageCount> {
    if (!isClickHouseEnabled()) {
      logger.warn(
        { organizationId },
        "getCurrentMonthCount: ClickHouse unavailable, usage is unknown",
      );
      return USAGE_UNKNOWN;
    }

    const billingMonth = getBillingMonth();
    const count = await queryBillableEventsTotalUniq({
      organizationId,
      billingMonth,
    });

    logger.info(
      { organizationId, count, billingMonth },
      "getCurrentMonthCount: billable events total",
    );
    // A null total means the query did not run, not that nothing was billed.
    if (count === null || count === undefined) {
      logger.warn(
        { organizationId, billingMonth },
        "getCurrentMonthCount: no total returned, usage is unknown",
      );
      return USAGE_UNKNOWN;
    }
    return count;
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

    if (!isClickHouseEnabled()) {
      logger.warn(
        { organizationId },
        "getCountByProjects: ClickHouse unavailable, usage is unknown",
      );
      return USAGE_UNKNOWN;
    }

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
