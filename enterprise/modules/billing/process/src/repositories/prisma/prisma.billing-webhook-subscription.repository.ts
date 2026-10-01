import { createLogger } from "@langwatch/observability";
/**
 * Subscription writes from Stripe webhooks. P2025 (missing row) reports
 * "missing_subscription"; other failures are rethrown so Stripe retries.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  BillingWebhookSubscriptionRepository,
  type ActivateSubscriptionResult,
  type CancelledSubscription,
  type SubscriptionMutationResult,
  type SubscriptionWithOrg,
} from "../billing-webhook-subscription.repository.ts";
import type {
  BillingSubscriptionRecord,
  BillingSubscriptionRepository,
  BillingSubscriptionWithOrganization,
} from "../subscription.repository.ts";

const logger = createLogger("langwatch:billing:webhook-subscription-adapter");

/** The one organization column the port carries that the repository does not select. */
export type BillingWebhookTrialLicenseDatabase = Pick<PrismaClient, "organization">;

export class PrismaBillingWebhookSubscriptionRepository extends BillingWebhookSubscriptionRepository {
  private constructor(
    private readonly subscriptions: BillingSubscriptionRepository,
    private readonly database: BillingWebhookTrialLicenseDatabase,
  ) {
    super();
  }

  static create(options: {
    subscriptions: BillingSubscriptionRepository;
    database: BillingWebhookTrialLicenseDatabase;
  }): PrismaBillingWebhookSubscriptionRepository {
    return new PrismaBillingWebhookSubscriptionRepository(options.subscriptions, options.database);
  }

  findLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.findLastNonCancelled(organizationId);
  }

  createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord> {
    return this.subscriptions.createPending(input);
  }

  updateStatus(input: {
    id: string;
    status: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>> {
    return this.asMutationResult("updateStatus", () => this.subscriptions.updateStatus(input));
  }

  updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>> {
    return this.asMutationResult("updatePlan", () => this.subscriptions.updatePlan(input));
  }

  findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.findByStripeId(stripeSubscriptionId);
  }

  linkStripeId(input: { id: string; stripeSubscriptionId: string }): Promise<{ count: number }> {
    return this.subscriptions.linkStripeId(input);
  }

  async activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<ActivateSubscriptionResult> {
    const activated = await this.orNull("activate", () => this.subscriptions.activate(input));
    return activated
      ? { outcome: "activated", subscription: await this.withTrialLicense(activated) }
      : { outcome: "missing_subscription" };
  }

  recordPaymentFailure(input: { id: string; currentStatus: string }): Promise<void> {
    return this.subscriptions.recordPaymentFailure(input);
  }

  cancel(input: { id: string }): Promise<void> {
    return this.subscriptions.cancel(input);
  }

  cancelTrialSubscriptions(organizationId: string): Promise<void> {
    return this.subscriptions.cancelTrialSubscriptions(organizationId);
  }

  migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<CancelledSubscription[]> {
    return this.subscriptions.migrateToSeatEvent(input);
  }

  async updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionMutationResult<SubscriptionWithOrg>> {
    const updated = await this.orNull("updateQuantities", () =>
      this.subscriptions.updateQuantities(input),
    );
    return updated
      ? { outcome: "updated", subscription: await this.withTrialLicense(updated) }
      : { outcome: "missing_subscription" };
  }

  /**
   * The trial licence a paid subscription retires, read beside the row
   * rather than selected with it: the repository's organization shape is
   * shared with every other billing surface, none of which needs a licence key.
   */
  private async withTrialLicense(
    subscription: BillingSubscriptionWithOrganization,
  ): Promise<SubscriptionWithOrg> {
    const organization = await this.database.organization.findUnique({
      where: { id: subscription.organizationId },
      select: { license: true },
    });
    return {
      ...subscription,
      organization: { ...subscription.organization, license: organization?.license ?? null },
    };
  }

  private async orNull<T>(operation: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      if (!isRecordNotFound(error)) {
        throw error;
      }
      logger.warn({ operation }, "[stripeWebhook] Subscription write found no row");
      return null;
    }
  }

  private async asMutationResult<T>(
    operation: string,
    run: () => Promise<T>,
  ): Promise<SubscriptionMutationResult<T>> {
    const subscription = await this.orNull(operation, run);
    return subscription
      ? { outcome: "updated", subscription }
      : { outcome: "missing_subscription" };
  }
}

/** Prisma P2025: a required record was not found. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
