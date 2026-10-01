import { USAGE_UNKNOWN } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { BillableEventsRepository } from "../repositories/billable-events.repository.ts";

const logger = createLogger("langwatch:billing:billableEventsQuery");

/**
 * A ClickHouse outage and a verified zero call for different responses:
 * skip the month on outage, but a legitimate zero may be reported. Named
 * so the outage isn't collapsed into a value the query never produced.
 */
export type BillableEventsTotalResult =
  | { outcome: "counted"; total: number }
  | { outcome: "unavailable" };

/**
 * Queries ClickHouse for the count of distinct billable events for an org in a billing month.
 */
export class BillableEventsQueryService {
  private constructor(private readonly repository: BillableEventsRepository | null) {}

  static create(repository: BillableEventsRepository | null): BillableEventsQueryService {
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

  async queryBillableEventsTotal({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillableEventsTotalResult> {
    const repository = this.repository;
    if (!repository) {
      logger.warn({ organizationId }, "ClickHouse not available, skipping billable events query");

      return { outcome: "unavailable" };
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);
    const total = await repository.findTotal({ organizationId, startDate, endDate });

    return { outcome: "counted", total };
  }

  /**
   * Approximate count of distinct billable events for an org in a billing month.
   * Uses HyperLogLog (~1% error, constant memory).
   */
  async queryBillableEventsTotalUniq({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillableEventsTotalResult> {
    const repository = this.repository;
    if (!repository) {
      logger.warn({ organizationId }, "ClickHouse not available, skipping billable events query");

      return { outcome: "unavailable" };
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);
    const total = await repository.findTotalUniq({
      organizationId,
      startDate,
      endDate,
    });

    return { outcome: "counted", total };
  }

  /** Main's `EventUsageService.getCountByProjects`: missing projects count 0. */
  async countBillableEventsByProjects({
    organizationId,
    projectIds,
    now = nowInstant(),
  }: {
    organizationId: string;
    projectIds: string[];
    now?: Instant;
  }): Promise<{ projectId: string; count: number }[] | typeof USAGE_UNKNOWN> {
    if (projectIds.length === 0) return [];

    if (!this.repository) {
      logger.warn(
        { organizationId },
        "getCountByProjects: ClickHouse unavailable, usage is unknown",
      );

      return USAGE_UNKNOWN;
    }

    const counts = await this.queryBillableEventsByProjectApprox({
      organizationId,
      billingMonth: BillableEventsQueryService.getBillingMonth(now),
    });
    const countsByProject = new Map(counts.map((c) => [c.projectId, c.count]));

    return projectIds.map((projectId) => ({
      projectId,
      count: countsByProject.get(projectId) ?? 0,
    }));
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
  }): Promise<{ projectId: string; count: number }[]> {
    const repository = this.repository;
    if (!repository) {
      logger.warn(
        { organizationId },
        "ClickHouse not available, skipping billable events by project query",
      );

      return [];
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return repository.findByProjectApprox({
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
  }): Promise<{ projectId: string; count: number }[]> {
    const repository = this.repository;
    if (!repository) {
      logger.warn(
        { organizationId },
        "ClickHouse not available, skipping billable events by project query",
      );

      return [];
    }

    const [startDate, endDate] = BillableEventsQueryService.billingMonthDateRange(billingMonth);

    return repository.findByProject({
      organizationId,
      startDate,
      endDate,
    });
  }
}
