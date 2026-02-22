import { getClickHouseClient } from "../../../src/server/clickhouse/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:billing:billableEventsQuery");

/**
 * Formats a date as a billing month string (YYYY-MM).
 */
export function getBillingMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Returns the billing month string for the previous month.
 */
export function getPreviousBillingMonth(now: Date = new Date()): string {
  const prev = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  return getBillingMonth(prev);
}

/**
 * Converts a billing month string (YYYY-MM) to a [startDate, endDate) range.
 * Returns ISO datetime strings suitable for ClickHouse DateTime64 comparisons.
 */
export function billingMonthDateRange(billingMonth: string): [string, string] {
  const [yearStr, monthStr] = billingMonth.split("-") as [string, string];
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01 00:00:00.000`;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const endYear = nextMonth.getUTCFullYear();
  const endMonth = String(nextMonth.getUTCMonth() + 1).padStart(2, "0");
  const endDate = `${endYear}-${endMonth}-01 00:00:00.000`;
  return [startDate, endDate];
}

/**
 * Queries ClickHouse for the count of distinct billable events for an org in a billing month.
 */
export async function queryBillableEventsTotal({
  organizationId,
  billingMonth,
}: {
  organizationId: string;
  billingMonth: string;
}): Promise<number | null> {
  const client = getClickHouseClient();
  if (!client) {
    logger.warn(
      { organizationId },
      "ClickHouse not available, skipping billable events query"
    );
    return null;
  }

  const [startDate, endDate] = billingMonthDateRange(billingMonth);

  const result = await client.query({
    query: `
      SELECT countDistinct(DeduplicationKeyHash) as total
      FROM billable_events
      WHERE OrganizationId = {organizationId:String}
        AND EventTimestamp >= {startDate:DateTime64(3)}
        AND EventTimestamp < {endDate:DateTime64(3)}
    `,
    query_params: { organizationId, startDate, endDate },
    format: "JSONEachRow",
  });

  const jsonResult = await result.json();
  const rows = Array.isArray(jsonResult) ? jsonResult : [];
  const firstRow = rows[0] as { total: string } | undefined;
  return parseInt(firstRow?.total ?? "0", 10);
}

/**
 * Approximate count of distinct billable events for an org in a billing month.
 * Uses HyperLogLog (~1% error, constant memory). Suitable for limit checking, not billing.
 */
export async function queryBillableEventsTotalApprox({
  organizationId,
  billingMonth,
}: {
  organizationId: string;
  billingMonth: string;
}): Promise<number | null> {
  const client = getClickHouseClient();
  if (!client) {
    logger.warn(
      { organizationId },
      "ClickHouse not available, skipping billable events query"
    );
    return null;
  }

  const [startDate, endDate] = billingMonthDateRange(billingMonth);

  const result = await client.query({
    query: `
      SELECT uniq(DeduplicationKeyHash) as total
      FROM billable_events
      WHERE OrganizationId = {organizationId:String}
        AND EventTimestamp >= {startDate:DateTime64(3)}
        AND EventTimestamp < {endDate:DateTime64(3)}
    `,
    query_params: { organizationId, startDate, endDate },
    format: "JSONEachRow",
  });

  const jsonResult = await result.json();
  const rows = Array.isArray(jsonResult) ? jsonResult : [];
  const firstRow = rows[0] as { total: string } | undefined;
  return parseInt(firstRow?.total ?? "0", 10);
}

/**
 * Approximate per-project billable event counts using HyperLogLog (~1% error).
 * Suitable for limit checking and UI display, not billing.
 */
export async function queryBillableEventsByProjectApprox({
  organizationId,
  billingMonth,
}: {
  organizationId: string;
  billingMonth: string;
}): Promise<Array<{ projectId: string; count: number }>> {
  const client = getClickHouseClient();
  if (!client) {
    logger.warn(
      { organizationId },
      "ClickHouse not available, skipping billable events by project query"
    );
    return [];
  }

  const [startDate, endDate] = billingMonthDateRange(billingMonth);

  const result = await client.query({
    query: `
      SELECT TenantId as projectId, uniq(DeduplicationKeyHash) as total
      FROM billable_events
      WHERE OrganizationId = {organizationId:String}
        AND EventTimestamp >= {startDate:DateTime64(3)}
        AND EventTimestamp < {endDate:DateTime64(3)}
      GROUP BY TenantId
    `,
    query_params: { organizationId, startDate, endDate },
    format: "JSONEachRow",
  });

  const jsonResult = await result.json();
  const rows = Array.isArray(jsonResult) ? jsonResult : [];
  return (rows as Array<{ projectId: string; total: string }>).map((row) => ({
    projectId: row.projectId,
    count: parseInt(row.total, 10),
  }));
}

/**
 * Queries ClickHouse for billable event counts grouped by project (TenantId)
 * for an org in a billing month.
 */
export async function queryBillableEventsByProject({
  organizationId,
  billingMonth,
}: {
  organizationId: string;
  billingMonth: string;
}): Promise<Array<{ projectId: string; count: number }>> {
  const client = getClickHouseClient();
  if (!client) {
    logger.warn(
      { organizationId },
      "ClickHouse not available, skipping billable events by project query"
    );
    return [];
  }

  const [startDate, endDate] = billingMonthDateRange(billingMonth);

  const result = await client.query({
    query: `
      SELECT TenantId as projectId, countDistinct(DeduplicationKeyHash) as total
      FROM billable_events
      WHERE OrganizationId = {organizationId:String}
        AND EventTimestamp >= {startDate:DateTime64(3)}
        AND EventTimestamp < {endDate:DateTime64(3)}
      GROUP BY TenantId
    `,
    query_params: { organizationId, startDate, endDate },
    format: "JSONEachRow",
  });

  const jsonResult = await result.json();
  const rows = Array.isArray(jsonResult) ? jsonResult : [];
  return (rows as Array<{ projectId: string; total: string }>).map((row) => ({
    projectId: row.projectId,
    count: parseInt(row.total, 10),
  }));
}
