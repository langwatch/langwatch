import { createLogger } from "@langwatch/observability";
import type { BillableEventsPort } from "../ports/billable-events.port.ts";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

const logger = createLogger("langwatch:billing:billableEventsQuery");

/**
 * Queries ClickHouse for the count of distinct billable events for an org in a billing month.
 */
export class BillableEventsQueryService {
  private constructor(private readonly repository: BillableEventsPort | null) {}

  static create(repository: BillableEventsPort | null): BillableEventsQueryService {
    return new BillableEventsQueryService(repository);
  }

  /** Formats a date as a billing month string (YYYY-MM). */
  static getBillingMonth(now: Instant = nowInstant()): string {
    const utc = now.toZonedDateTimeISO("UTC");

    return `${utc.year}-${String(utc.month).padStart(2, "0")}`;
  }

  /** Returns the billing month string for the previous month. */
  static getPreviousBillingMonth(now: Instant = nowInstant()): string {
    const previous = now.toZonedDateTimeISO("UTC").subtract({ months: 1 });

    return `${previous.year}-${String(previous.month).padStart(2, "0")}`;
  }

  /** Converts YYYY-MM into a ClickHouse [start, end) datetime range. */
  static billingMonthDateRange(billingMonth: string): [string, string] {
    const [yearText, monthText] = billingMonth.split("-") as [string, string];
    const year = Number.parseInt(yearText, 10);
    const month = Number.parseInt(monthText, 10);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01 00:00:00.000`;
    const nextMonth = Temporal.PlainDateTime.from({ year, month: 1, day: 1 }).add({
      months: month,
    });

    return [
      startDate,
      `${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}-01 00:00:00.000`,
    ];
  }

  async tryQueryBillableEventsTotal({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<number | null> {
    const repository = this.repository;
    if (!repository) {
      logger.warn({ organizationId }, "ClickHouse not available, skipping billable events query");

      return null;
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return await repository.findTotal({ organizationId, startDate, endDate });
  }

  /**
   * Approximate count of distinct billable events for an org in a billing month.
   * Uses HyperLogLog (~1% error, constant memory).
   */
  async tryQueryBillableEventsTotalUniq({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<number | null> {
    const repository = this.repository;
    if (!repository) {
      logger.warn({ organizationId }, "ClickHouse not available, skipping billable events query");

      return null;
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return await repository.findTotalUniq({
      organizationId,
      startDate,
      endDate,
    });
  }

  /**
   * Approximate count of distinct trace events for an org in a current month.
   * Uses HyperLogLog (~1% error, constant memory).
   */
  async tryQueryTraceSummariesTotalUniq({
    projectIds,
    billingMonth,
  }: {
    projectIds: string[];
    billingMonth: string;
  }): Promise<number | null> {
    if (projectIds.length === 0) {
      return 0;
    }

    const repository = this.repository;
    if (!repository) {
      logger.warn({ projectIds }, "ClickHouse not available, skipping trace summaries query");

      return null;
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return await repository.findTraceSummariesTotalUniq({
      tenantIds: projectIds,
      startDate,
      endDate,
    });
  }

  /**
   * Approximate per-project billable event counts using HyperLogLog (~1% error).
   * Suitable for limit checking and UI display, not billing.
   */
  async queryBillableEventsByProjectApprox({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<Array<{ projectId: string; count: number }>> {
    const repository = this.repository;
    if (!repository) {
      logger.warn(
        { organizationId },
        "ClickHouse not available, skipping billable events by project query",
      );

      return [];
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return await repository.findByProjectApprox({
      organizationId,
      startDate,
      endDate,
    });
  }

  /**
   * Queries ClickHouse for billable event counts grouped by project (TenantId)
   * for an org in a billing month.
   */
  async queryBillableEventsByProject({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<Array<{ projectId: string; count: number }>> {
    const repository = this.repository;
    if (!repository) {
      logger.warn(
        { organizationId },
        "ClickHouse not available, skipping billable events by project query",
      );

      return [];
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return await repository.findByProject({
      organizationId,
      startDate,
      endDate,
    });
  }
}
