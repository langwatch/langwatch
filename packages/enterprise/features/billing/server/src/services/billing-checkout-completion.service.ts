// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a completed Stripe checkout does to our records: linking the subscription, persisting
 * the currency the buyer chose, approving the invites the payment was pending on, and setting
 * the annual billing threshold.
 */
import { createLogger } from "@langwatch/observability";
import type { PostHog } from "posthog-node";
import type Stripe from "stripe";
import { Currency, SubscriptionRecordNotFoundError } from "@langwatch/enterprise-billing-contract";
import { AnnualEventsBillingThresholdService } from "./annual-events-billing-threshold.service.ts";
import { BestEffortService } from "./best-effort.service.ts";
import { BillingSubscriptionLifecycleService } from "./billing-subscription-lifecycle.service.ts";
import type { SubscriptionItemCalculatorService } from "./subscription-item-calculator.service.ts";
import type { BillingWebhookHostPort } from "../ports/billing-webhook-host.port.ts";
import type { BillingWebhookOrganizationPort } from "../ports/billing-webhook-organization.port.ts";
import type { BillingWebhookSubscriptionPort } from "../ports/billing-webhook-subscription.port.ts";
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";

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
  subscriptionRepository: BillingWebhookSubscriptionPort;
  organizationRepository: BillingWebhookOrganizationPort;
  stripe: Stripe;
  itemCalculator: Pick<SubscriptionItemCalculatorService, "calculateQuantityForPrice"> & {
    prices: StripePriceMap;
  };
  inviteApprover?: InviteApprover;
  getPostHog?: () => PostHog | null;
  host: BillingWebhookHostPort;
};

export class BillingCheckoutCompletionService {
  static create(options: BillingCheckoutCompletionOptions): BillingCheckoutCompletionService {
    return new BillingCheckoutCompletionService(options);
  }

  private readonly subscriptionRepository: BillingWebhookSubscriptionPort;
  private readonly organizationRepository: BillingWebhookOrganizationPort;
  private readonly inviteApprover?: InviteApprover;
  private readonly getPostHog?: () => PostHog | null;
  private readonly host: BillingWebhookHostPort;
  private readonly bestEffort = BestEffortService.create();
  private readonly annualThreshold: AnnualEventsBillingThresholdService;
  private readonly lifecycle: BillingSubscriptionLifecycleService;

  private constructor(options: BillingCheckoutCompletionOptions) {
    this.subscriptionRepository = options.subscriptionRepository;
    this.organizationRepository = options.organizationRepository;
    this.inviteApprover = options.inviteApprover;
    this.getPostHog = options.getPostHog;
    this.host = options.host;
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
      await this.bestEffort.run({
        label: "checkout analytics",
        context: { eventId: event.id, organizationId },
        effect: () =>
          this.emitCheckoutAnalytics({
            checkoutSession,
            subscriptionId,
            organizationId,
          }),
      });
    }
  }

  private emitCheckoutAnalytics({
    checkoutSession,
    subscriptionId,
    organizationId,
  }: {
    checkoutSession: Stripe.Checkout.Session;
    subscriptionId: string;
    organizationId: string;
  }): void {
    const posthog = this.getPostHog?.() ?? null;
    if (!posthog) {
      return;
    }

    posthog.capture({
      distinctId: organizationId,
      event: "subscription_created",
      properties: {
        subscriptionId,
        $groups: { organization: organizationId },
      },
    });
    posthog.groupIdentify({
      groupType: "organization",
      groupKey: organizationId,
      properties: {
        subscriptionCreatedAt: new Date(checkoutSession.created * 1000).toISOString(),
        hasActiveSubscription: true,
      },
    });
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

    const subscriptionRecord = await this.subscriptionRepository.tryFindByStripeId(subscriptionId);

    const normalizedCurrency = this.normalizeSelectedCurrency(selectedCurrency);
    if (normalizedCurrency && subscriptionRecord) {
      try {
        await this.organizationRepository.updateCurrency({
          organizationId: subscriptionRecord.organizationId,
          currency: normalizedCurrency,
        });
      } catch (err) {
        logger.warn(
          { subscriptionId, selectedCurrency: normalizedCurrency, err },
          "[stripeWebhook] Failed to persist selected currency on checkout completion",
        );
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
          "[stripeWebhook] Failed to approve PAYMENT_PENDING invites after checkout, manual resolution may be needed",
        );
      }
    }

    // Cancel any active trial subscriptions for this org
    if (subscriptionRecord) {
      await this.subscriptionRepository.cancelTrialSubscriptions(subscriptionRecord.organizationId);
    }

    await this.trySetAnnualEventsBillingThreshold(subscriptionId);

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
