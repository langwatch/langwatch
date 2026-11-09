// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Storage above the 90 days Growth includes: the metered line follows the organization's longest
 * retention, and each daily measurement goes to the meter as that day's share of a GB-month.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import {
  type BillingInterval,
  type Currency,
  isGrowthSeatPrice,
  isRetentionStoragePrice,
  pickRetentionStoragePriceId,
  type RetentionStorageOutcome,
  type RetentionStorageReport,
  retentionBillsStorage,
  retentionStorageMeterIdentifier,
  retentionStorageReportSchema,
  type StripePriceMap,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { StripeMetersChannel } from "../channels/stripe-meters.channel.ts";
import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";
import type { BillingSubscription } from "../rules/billing-stripe-shapes.rules.ts";
import { retentionStorageShare } from "../rules/retention-storage.rules.ts";

const logger = createLogger("langwatch:billing:retention-storage");

/** The meter event name the storage meter is provisioned with in every Stripe mode. */
export const RETENTION_STORAGE_METER_EVENT_NAME = "langwatch_retention_storage_gb";

const SKIPPED: RetentionStorageOutcome = { line: "skipped", reportedGbMonths: null };

type Options = Readonly<{
  subscriptions: Pick<SeatEventSubscriptionRepository, "findSeatCandidates">;
  stripeSubscriptions: Pick<StripeSubscriptionsChannel, "getSubscription" | "updateSubscription">;
  meters: Pick<StripeMetersChannel, "createMeterEvent">;
  prices: StripePriceMap;
  /** Whether this Stripe mode holds the storage meter; without it nothing is reported. */
  isMeterProvisioned: boolean;
  now?: () => number;
}>;

export class RetentionStorageBillingService {
  static create(options: Options): RetentionStorageBillingService {
    return new RetentionStorageBillingService(options);
  }

  private constructor(private readonly options: Options) {}

  async record(input: RetentionStorageReport): Promise<RetentionStorageOutcome> {
    const report = retentionStorageReportSchema.parse(input);
    const stripeSubscription = await this.activeSeatSubscription(report.organizationId);
    if (!stripeSubscription) return SKIPPED;

    const billsStorage =
      report.longestRetentionDays === 0 || retentionBillsStorage(report.longestRetentionDays);
    const storageItem = stripeSubscription.items.find((item) =>
      isRetentionStoragePrice(item.priceId, this.options.prices),
    );
    if (!billsStorage) {
      if (!storageItem) return { line: "absent", reportedGbMonths: null };
      await this.options.stripeSubscriptions.updateSubscription({
        subscriptionId: stripeSubscription.id,
        change: { items: [{ id: storageItem.id, deleted: true }], prorationBehavior: "none" },
      });
      return { line: "removed", reportedGbMonths: null };
    }

    const line = storageItem ? "kept" : await this.addStorageLine(stripeSubscription);
    if (line === "skipped") return SKIPPED;
    return { line, reportedGbMonths: await this.report({ report, stripeSubscription }) };
  }

  /** The organization's live Growth seat subscription at the provider, or none to bill. */
  private async activeSeatSubscription(
    organizationId: string,
  ): Promise<BillingSubscription | undefined> {
    const candidates = await this.options.subscriptions.findSeatCandidates({ organizationId });
    const active = candidates.filter(
      (row) => row.status === SubscriptionStatus.ACTIVE && row.stripeSubscriptionId !== null,
    );
    // Two live plans are refused elsewhere; billing storage on either would be a guess.
    if (active.length !== 1 || !active[0]?.stripeSubscriptionId) {
      logger.info(
        { organizationId, candidates: candidates.length, active: active.length },
        "No single live Growth seat subscription; retention storage not billed",
      );
      return void 0;
    }
    const subscription = await this.options.stripeSubscriptions.getSubscription({
      subscriptionId: active[0].stripeSubscriptionId,
    });
    const hasSeatLine = subscription.items.some((item) =>
      isGrowthSeatPrice(item.priceId, this.options.prices),
    );
    if (subscription.status === "active" && hasSeatLine) return subscription;
    logger.info(
      { organizationId, subscriptionId: subscription.id, status: subscription.status, hasSeatLine },
      "Subscription is not an active Growth seat plan; retention storage not billed",
    );
    return void 0;
  }

  private async addStorageLine(subscription: BillingSubscription): Promise<"added" | "skipped"> {
    const seatItem = subscription.items.find((item) =>
      isGrowthSeatPrice(item.priceId, this.options.prices),
    );
    const currency = (subscription.currency ?? "").toUpperCase() as Currency;
    const interval: BillingInterval = seatItem?.interval === "year" ? "annual" : "monthly";
    const priceId = pickRetentionStoragePriceId({
      currency,
      interval,
      prices: this.options.prices,
    });
    if (!priceId) {
      logger.error(
        { subscriptionId: subscription.id, currency, interval },
        "Retention storage price is not provisioned in this Stripe mode; storage above 90 days is not billed",
      );
      return "skipped";
    }
    await this.options.stripeSubscriptions.updateSubscription({
      subscriptionId: subscription.id,
      change: { items: [{ price: priceId }], prorationBehavior: "none" },
    });
    return "added";
  }

  /** Sends the day's share; an identifier already sent for that day is the same report again. */
  private async report({
    report,
    stripeSubscription,
  }: {
    report: RetentionStorageReport;
    stripeSubscription: BillingSubscription;
  }): Promise<number | null> {
    if (report.bytesAboveIncluded === undefined) return null;
    const customerId = stripeSubscription.customerId;
    if (!this.options.isMeterProvisioned || !customerId) {
      logger.error(
        { organizationId: report.organizationId, hasCustomer: Boolean(customerId) },
        "Retention storage meter is not provisioned in this Stripe mode; nothing reported",
      );
      return null;
    }
    const measuredAtMs = report.measuredAt ?? (this.options.now ?? Date.now)();
    const { share, value, day } = retentionStorageShare({
      bytes: report.bytesAboveIncluded,
      measuredAtMs,
    });
    try {
      await this.options.meters.createMeterEvent({
        eventName: RETENTION_STORAGE_METER_EVENT_NAME,
        customerId,
        value,
        identifier: retentionStorageMeterIdentifier({ organizationId: report.organizationId, day }),
        timestamp: Math.floor(measuredAtMs / 1000),
      });
    } catch (error) {
      if (isAlreadyReported(error)) return share;
      throw error;
    }
    return share;
  }
}

function isAlreadyReported(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "resource_already_exists"
  );
}
