import { getClickHouseClient } from "~/server/clickhouse/client";
import {
  queryBillableEventsTotalUniq,
  queryBillableEventsByProjectApprox,
  getBillingMonth,
} from "../../../ee/billing/services/billableEventsQuery";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:traces:eventUsage");

/**
 * Events-only counting execution service.
 *
 * Queries the ClickHouse `billable_events` table for event counts.
 * Returns 0 when ClickHouse is unavailable (fail-open).
 */
export class EventUsageService {
  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    if (!getClickHouseClient()) {
      logger.warn(
        { organizationId },
        "getCurrentMonthCount: ClickHouse unavailable, returning 0 (fail-open)",
      );
      return 0;
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
    return count ?? 0;
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

    if (!getClickHouseClient()) {
      logger.warn(
        { organizationId },
        "getCountByProjects: ClickHouse unavailable, returning zeros (fail-open)",
      );
      return projectIds.map((projectId) => ({ projectId, count: 0 }));
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
