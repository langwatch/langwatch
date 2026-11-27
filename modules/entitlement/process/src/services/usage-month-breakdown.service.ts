/**
 * The month on the usage page: the organization's count per UTC day, per kind of event and per
 * project, read off the same meters and the same per-project count the limit email uses.
 * @see specs/licensing/usage-page.feature
 */
import {
  USAGE_CATEGORIES,
  type ProjectUsageShare,
  type UsageCategory,
  type UsageCategoryCount,
  type UsageDay,
  type UsageMonthBreakdown,
} from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type {
  BillableEventsMeterRepository,
  MeterWindow,
} from "../repositories/billable-events-meter.repository.ts";
import type { TenancyRepository } from "../repositories/tenancy.repository.ts";
import { categoryOfBillableEventType, NOT_BILLED } from "../rules/billable-event.rules.ts";
import { USAGE_UNKNOWN, type UsageCounter } from "./usage-enforcement.service.ts";

const logger = createLogger("langwatch:usage:month-breakdown");

type YearMonth = ReturnType<typeof Temporal.PlainYearMonth.from>;

/** A metered read failed, as opposed to an organization that is not metered in events. */
const UNAVAILABLE = Symbol("unavailable");

type MonthBreakdownSources = {
  counter: Pick<UsageCounter, "getResolvedUsageUnit" | "getCountByProjects">;
  meter: Pick<BillableEventsMeterRepository, "countByDay" | "countByType">;
  tenancy: Pick<TenancyRepository, "findProjectIds" | "findProjectNames">;
  /** The instant the month is read at; the current one in production. */
  now?: () => Instant;
};

type MeteredMonth = {
  days: UsageDay[] | typeof UNAVAILABLE;
  byCategory: UsageCategoryCount[] | typeof UNAVAILABLE;
};

export class UsageMonthBreakdownService {
  static create(sources: MonthBreakdownSources): UsageMonthBreakdownService {
    return new UsageMonthBreakdownService(sources);
  }

  private constructor(private readonly sources: MonthBreakdownSources) {}

  async getMonthBreakdown({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<UsageMonthBreakdown> {
    const now = this.sources.now?.() ?? nowInstant();
    const month = Temporal.PlainYearMonth.from(now.toZonedDateTimeISO("UTC").toPlainDate());
    const nextMonth = month.add({ months: 1 });
    const usageUnit = await this.sources.counter.getResolvedUsageUnit({ organizationId });
    const [metered, projects] = await Promise.all([
      usageUnit === "events" ? this.meteredMonth({ organizationId, month }) : Promise.resolve(null),
      this.projects({ organizationId }),
    ]);

    return {
      resetsOn: nextMonth.toPlainDate({ day: 1 }).toString(),
      days: metered === null || metered.days === UNAVAILABLE ? null : metered.days,
      isDailyUnavailable: metered?.days === UNAVAILABLE,
      projects,
      byCategory:
        metered === null || metered.byCategory === UNAVAILABLE ? null : metered.byCategory,
      isByCategoryUnavailable: metered?.byCategory === UNAVAILABLE,
    };
  }

  /** The day and kind reads over the organization's projects, each failing on its own. */
  private async meteredMonth({
    organizationId,
    month,
  }: {
    organizationId: string;
    month: YearMonth;
  }): Promise<MeteredMonth> {
    const window: MeterWindow = {
      startDate: `${month.toString()}-01 00:00:00.000`,
      endDate: `${month.add({ months: 1 }).toString()}-01 00:00:00.000`,
    };
    let projectIds: readonly string[];
    try {
      projectIds = await this.sources.tenancy.findProjectIds({ organizationId });
    } catch (error) {
      logger.warn({ organizationId, error }, "The organization's projects could not be read");
      return { days: UNAVAILABLE, byCategory: UNAVAILABLE };
    }
    const [days, byCategory] = await Promise.all([
      this.days({ organizationId, projectIds, month, window }),
      this.byCategory({ organizationId, projectIds, window }),
    ]);
    return { days, byCategory };
  }

  /** Every day of the month, zero where nothing was metered. */
  private async days({
    organizationId,
    projectIds,
    month,
    window,
  }: {
    organizationId: string;
    projectIds: readonly string[];
    month: YearMonth;
    window: MeterWindow;
  }): Promise<UsageDay[] | typeof UNAVAILABLE> {
    try {
      const counts = await this.sources.meter.countByDay({ organizationId, projectIds, window });
      const byDay = new Map(counts.map(({ day, count }) => [day, count]));
      return Array.from({ length: month.daysInMonth }, (_, index) => {
        const date = month.toPlainDate({ day: index + 1 }).toString();
        return { date, count: byDay.get(date) ?? 0 };
      });
    } catch (error) {
      logger.warn({ organizationId, error }, "The daily usage meter could not answer");
      return UNAVAILABLE;
    }
  }

  /** Every kind in the page's order, zero where nothing was metered. */
  private async byCategory({
    organizationId,
    projectIds,
    window,
  }: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<UsageCategoryCount[] | typeof UNAVAILABLE> {
    try {
      const counts = await this.sources.meter.countByType({ organizationId, projectIds, window });
      const totals = new Map<UsageCategory, number>();
      for (const { eventType, count } of counts) {
        const category = categoryOfBillableEventType(eventType);
        if (category !== NOT_BILLED) totals.set(category, (totals.get(category) ?? 0) + count);
      }
      return USAGE_CATEGORIES.map((category) => ({ category, count: totals.get(category) ?? 0 }));
    } catch (error) {
      logger.warn({ organizationId, error }, "The per-kind usage meter could not answer");
      return UNAVAILABLE;
    }
  }

  /** Projects that used the month, the busiest first; null when a store could not answer. */
  private async projects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ProjectUsageShare[] | null> {
    const read = await this.projectCounts({ organizationId });
    if (read === null) return null;
    const { projects, counts } = read;
    const countById = new Map(counts.map(({ projectId, count }) => [projectId, count]));

    return projects
      .map((project) => ({
        projectId: project.id,
        name: project.name,
        count: countById.get(project.id) ?? 0,
      }))
      .filter((project) => project.count > 0)
      .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  private async projectCounts({ organizationId }: { organizationId: string }) {
    try {
      const projects = await this.sources.tenancy.findProjectNames({ organizationId });
      const counts = await this.sources.counter.getCountByProjects({
        organizationId,
        projectIds: projects.map((project) => project.id),
      });
      return counts === USAGE_UNKNOWN ? null : { projects, counts };
    } catch (error) {
      logger.warn({ organizationId, error }, "The per-project usage could not be read");
      return null;
    }
  }
}
