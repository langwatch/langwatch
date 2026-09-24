import type { BillingUsageCounter } from "@langwatch/enterprise-billing-contract";
import { fromDate, type Instant } from "@langwatch/time";

import type { UsageWarningServiceOptions } from "../rules/usage-warning-thresholds.rules.ts";
import { UsageWarningService } from "./usage-warning.service.ts";

type Meter = "traces" | "events";

/** Main's `checkAndSendWarning` per meter, in the shape main's `limits` router returned. */
export class MeteredUsageWarningService {
  static create(
    options: Omit<UsageWarningServiceOptions, "usageCounts"> & {
      counters: Readonly<Record<Meter, BillingUsageCounter>>;
    },
  ): MeteredUsageWarningService {
    const { counters, ...shared } = options;
    return new MeteredUsageWarningService({
      traces: UsageWarningService.create({ ...shared, usageCounts: counters.traces }),
      events: UsageWarningService.create({ ...shared, usageCounts: counters.events }),
    });
  }

  private constructor(private readonly byMeter: Readonly<Record<Meter, UsageWarningService>>) {}

  async checkAndSendWarning(input: {
    organizationId: string;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    meter: Meter;
  }): Promise<{ sent: boolean; notificationId?: string; sentAt?: Instant }> {
    const { meter, ...data } = input;
    const result = await this.byMeter[meter].checkAndSendWarning(data);
    if (result.outcome === "skipped") return { sent: false };
    return {
      sent: true,
      notificationId: result.notification.id,
      sentAt: fromDate(result.notification.sentAt),
    };
  }
}
