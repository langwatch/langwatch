import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import type { MonthCountedEventData } from "@langwatch/usage-contract";

import type { BillableEventsMeterRepository } from "../repositories/billable-events-meter.repository.ts";
import type { TraceMeterRepository } from "../repositories/trace-meter.repository.ts";
import { isCapped, usageLimitOf, usageUnitOf } from "../rules/usage-limit.rules.ts";

const defaultLogger = createLogger("langwatch:usage:count");

type UsageCountingDependencies = Readonly<{
  meter: BillableEventsMeterRepository;
  traceMeter: TraceMeterRepository;
  entitlement: Pick<EntitlementApi, "getActivePlan">;
  billing: Pick<BillingApi, "getPricingModel">;
  logger?: Pick<Logger, "warn">;
}>;

/** Counts an organization's month from its own meters, against the plan the month is held to. */
export class UsageCountingService {
  private readonly meter: BillableEventsMeterRepository;
  private readonly traceMeter: TraceMeterRepository;
  private readonly entitlement: Pick<EntitlementApi, "getActivePlan">;
  private readonly billing: Pick<BillingApi, "getPricingModel">;
  private readonly logger: Pick<Logger, "warn">;

  private constructor(deps: UsageCountingDependencies) {
    this.meter = deps.meter;
    this.traceMeter = deps.traceMeter;
    this.entitlement = deps.entitlement;
    this.billing = deps.billing;
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: UsageCountingDependencies): UsageCountingService {
    return new UsageCountingService(deps);
  }

  /** `YYYY-MM` for an instant, in UTC as billing's checkpoints key it. */
  static monthOf(epochMs: number): string {
    return Temporal.Instant.fromEpochMilliseconds(epochMs)
      .toZonedDateTimeISO("UTC")
      .toPlainDate()
      .toPlainYearMonth()
      .toString();
  }

  /**
   * Billable events are always counted, for billing's Stripe report; traces only when a capped
   * plan is held in them. A meter that cannot answer throws, so nothing is decided and it retries.
   */
  async countMonth(input: {
    organizationId: string;
    month: string;
    occurredAt: number;
  }): Promise<MonthCountedEventData> {
    const { organizationId, month } = input;
    const plan = await this.entitlement.getActivePlan({ organizationId });
    const { pricingModel } = await this.billing.getPricingModel({ organizationId });
    const limit = usageLimitOf({ plan, unit: usageUnitOf({ plan, pricingModel }) });
    const start = Temporal.PlainYearMonth.from(month);
    try {
      const billableEvents = await this.meter.findTotal({
        organizationId,
        startDate: `${start.toString()}-01 00:00:00.000`,
        endDate: `${start.add({ months: 1 }).toString()}-01 00:00:00.000`,
      });
      if (limit.unit !== "traces" || !isCapped(limit)) return { ...input, billableEvents, limit };
      const traces = await this.traceMeter.findTotal({ organizationId, month });
      return { ...input, billableEvents, traces, limit };
    } catch (error) {
      this.logger.warn(
        { organizationId, plan: plan.name, error },
        "usage meter cannot be read, deciding nothing",
      );
      throw error;
    }
  }
}
