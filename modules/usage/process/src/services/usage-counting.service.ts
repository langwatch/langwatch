import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import type { MonthCountedEventData } from "@langwatch/usage-contract";

import type { BillableEventsMeterRepository } from "../repositories/billable-events-meter.repository.ts";
import { usageLimitOf, usageUnitOf } from "../rules/usage-limit.rules.ts";

const logger = createLogger("langwatch:usage:count");

/** Counts an organization's month from its own meter, against the plan the month is held to. */
export class UsageCountingService {
  private constructor(
    private readonly meter: BillableEventsMeterRepository,
    private readonly entitlement: Pick<EntitlementApi, "getActivePlan">,
    private readonly billing: Pick<BillingApi, "getPricingModel">,
  ) {}

  static create({
    meter,
    entitlement,
    billing,
  }: {
    meter: BillableEventsMeterRepository;
    entitlement: Pick<EntitlementApi, "getActivePlan">;
    billing: Pick<BillingApi, "getPricingModel">;
  }): UsageCountingService {
    return new UsageCountingService(meter, entitlement, billing);
  }

  /** `YYYY-MM` for an instant, in UTC as billing's checkpoints key it. */
  static monthOf(epochMs: number): string {
    return Temporal.Instant.fromEpochMilliseconds(epochMs)
      .toZonedDateTimeISO("UTC")
      .toPlainDate()
      .toPlainYearMonth()
      .toString();
  }

  /** A meter that cannot answer throws, so nothing is decided and the command retries. */
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
      return { ...input, billableEvents, limit };
    } catch (error) {
      logger.warn(
        { organizationId, plan: plan.name, error },
        "usage meter cannot be read, deciding nothing",
      );
      throw error;
    }
  }
}
