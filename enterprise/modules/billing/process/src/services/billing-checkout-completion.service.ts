import { Currency, SubscriptionRecordNotFoundError } from "@langwatch/enterprise-billing-contract";
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a completed Stripe checkout does to our records: linking the subscription, persisting
 * the currency the buyer chose, approving the invites the payment was pending on, and setting
 * the annual billing threshold.
 */
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";

import type { BillingWebhookHost } from "../channels/billing-webhook-host.channel.ts";
import type { BillingWebhookOrganizationRepository } from "../repositories/billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscriptionRepository } from "../repositories/billing-webhook-subscription.repository.ts";
import { AnnualEventsBillingThresholdService } from "./annual-events-billing-threshold.service.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import {
  BillingSubscriptionLifecycleService,
  type SeatRetentionRules,
} from "./billing-subscription-lifecycle.service.ts";
import type { SubscriptionItemCalculatorService } from "./subscription-item-calculator.service.ts";

const logger = createLogger("langwatch:billing:checkoutCompletion");

const VALID_CURRENCIES_FOR_CHECKOUT = new Set<string>(Object.values(Currency));
const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

export type InviteApprover = {
  approvePaymentPendingInvites(params: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<unknown>;
};

type BillingCheckoutCompletionOptions = {
  subscriptionRepository: BillingWebhookSubscriptionRepository;
  organizationRepository: BillingWebhookOrganizationRepository;
  stripe: Stripe;
  itemCalculator: Pick<SubscriptionItemCalculatorService, "calculateQuantityForPrice"> & {
    prices: StripePriceMap;
  };
  inviteApprover?: InviteApprover;
  host: BillingWebhookHost;
  retention: SeatRetentionRules;
  /** Records the checkout and subscription changes for peers; absent where none is composed. */
  announcer?: Pick<
    BillingLifecycleAnnouncerService,
    "checkoutCompleted" | "subscriptionActivated" | "subscriptionCancelled"
  >;
};

export class BillingCheckoutCompletionService {
  static create(options: BillingCheckoutCompletionOptions): BillingCheckoutCompletionService {
    return new BillingCheckoutCompletionService(options);
  }

  private readonly subscriptionRepository: BillingWebhookSubscriptionRepository;
  private readonly organizationRepository: BillingWebhookOrganizationRepository;
  private readonly inviteApprover?: InviteApprover;
  private readonly host: BillingWebhookHost;
  private readonly announcer: BillingCheckoutCompletionOptions["announcer"];
  private readonly annualThreshold: AnnualEventsBillingThresholdService;
  private readonly lifecycle: BillingSubscriptionLifecycleService;

  private constructor(options: BillingCheckoutCompletionOptions) {
    this.subscriptionRepository = options.subscriptionRepository;
    this.organizationRepository = options.organizationRepository;
    this.inviteApprover = options.inviteApprover;
    this.host = options.host;
    this.announcer = options.announcer;
    this.annualThreshold = AnnualEventsBillingThresholdService.create({
      stripe: options.stripe,
      prices: options.itemCalculator.prices,
    });
    this.lifecycle = BillingSubscriptionLifecycleService.create({
      subscriptionRepository: options.subscriptionRepository,
      organizationRepository: options.organizationRepository,
      stripe: options.stripe,
      itemCalculator: options.itemCalculator,
      host: options.host,
      retention: options.retention,
      ...(options.announcer ? { announcer: options.announcer } : {}),
    });
  }

  async dispatchCheckoutCompleted({
    event,
    subscriptionId,
    customerId,
    organizationId,
  }: {
    event: Stripe.Event & { type: "checkout.session.completed" };
    subscriptionId: string;
    customerId?: string;
    organizationId: string | null;
  }): Promise<void> {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const selectedCurrencyRaw = checkoutSession.metadata?.selectedCurrency;
    const selectedCurrency =
      selectedCurrencyRaw && VALID_CURRENCIES_FOR_CHECKOUT.has(selectedCurrencyRaw)
        ? selectedCurrencyRaw
        : null;

    const result = await this.handleCheckoutCompleted({
      subscriptionId,
      clientReferenceId: checkoutSession.client_reference_id ?? null,
      selectedCurrency,
    });

    if (result.earlyReturn) {
      logger.error(
        {
          eventId: event.id,
          customerId: customerId ? maskCustomerId(customerId) : null,
        },
        "[stripeWebhook] No client_reference_id in checkout session",
      );

      return;
    }

    if (organizationId) {
      await this.announcer?.checkoutCompleted({
        organizationId,
        subscriptionId,
        checkoutCreatedAt: Temporal.Instant.fromEpochMilliseconds(
          checkoutSession.created * 1000,
        ).toString(),
      });
    }
  }

  async handleCheckoutCompleted({
    subscriptionId,
    clientReferenceId,
    selectedCurrency,
  }: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean }> {
    const subscriptionClientReferenceId = clientReferenceId?.replace("subscription_setup_", "");

    if (!subscriptionClientReferenceId) {
      return { earlyReturn: true };
    }

    const updateResult = await this.subscriptionRepository.linkStripeId({
      id: subscriptionClientReferenceId,
      stripeSubscriptionId: subscriptionId,
    });

    if (updateResult.count === 0) {
      logger.error(
        { subscriptionClientReferenceId },
        "[stripeWebhook] No subscription found for checkout",
      );

      throw new SubscriptionRecordNotFoundError(subscriptionClientReferenceId);
    }

    await this.lifecycle.syncInvoicePaymentSuccess({
      subscriptionId,
      throwOnMissing: true,
    });

    const subscriptionRecord = await this.subscriptionRepository.findByStripeId(subscriptionId);

    // A failed follow-up still lets the plan land, then fails the delivery so
    // Stripe redelivers it: every step here is safe to repeat.
    const failures: unknown[] = [];
    const normalizedCurrency = this.normalizeSelectedCurrency(selectedCurrency);
    if (normalizedCurrency && subscriptionRecord) {
      try {
        await this.organizationRepository.updateCurrency({
          organizationId: subscriptionRecord.organizationId,
          currency: normalizedCurrency,
        });
      } catch (err) {
        logger.error(
          { subscriptionId, selectedCurrency: normalizedCurrency, err },
          "[stripeWebhook] Failed to persist selected currency on checkout completion; the delivery will be retried",
        );
        failures.push(err);
      }
    }

    // Approve PAYMENT_PENDING invites linked to this subscription
    if (this.inviteApprover && subscriptionRecord) {
      try {
        await this.inviteApprover.approvePaymentPendingInvites({
          subscriptionId: subscriptionRecord.id,
          organizationId: subscriptionRecord.organizationId,
        });
      } catch (err) {
        logger.error(
          { subscriptionId, err },
          "[stripeWebhook] Failed to approve PAYMENT_PENDING invites after checkout; the delivery will be retried",
        );
        failures.push(err);
      }
    }

    // Cancel any active trial subscriptions for this org
    if (subscriptionRecord) {
      await this.subscriptionRepository.cancelTrialSubscriptions(subscriptionRecord.organizationId);
    }

    await this.trySetAnnualEventsBillingThreshold(subscriptionId);

    if (failures.length > 0) throw failures[0];

    return { earlyReturn: false };
  }

  /**
   * The billing threshold makes Stripe collect annual overage in slices, not
   * one oversized invoice. Best-effort — we answer Stripe 200 regardless, so
   * a failure raises a (also best-effort) Slack alert instead.
   */
  private async trySetAnnualEventsBillingThreshold(subscriptionId: string): Promise<void> {
    try {
      const thresholdResult = await this.annualThreshold.apply({
        stripeSubscriptionId: subscriptionId,
      });
      logger.info(
        { subscriptionId, thresholdResult },
        "[stripeWebhook] Annual events billing threshold evaluated",
      );
    } catch (err) {
      logger.error(
        { subscriptionId, err },
        "[stripeWebhook] Failed to set annual events billing threshold — re-run the backfill script or apply manually",
      );
      try {
        await this.host.sendSlackBillingThresholdFailureAlert({
          stripeSubscriptionId: subscriptionId,
          reason: err instanceof Error ? err.message : String(err),
        });
      } catch (alertErr) {
        logger.error(
          { subscriptionId, err: alertErr },
          "[stripeWebhook] Failed to alert on billing-threshold failure",
        );
      }
    }
  }

  private normalizeSelectedCurrency(value?: string | null): Currency | null {
    if (value === Currency.EUR || value === Currency.USD) {
      return value;
    }

    return null;
  }
}
