/**
 * The subscription writes a Stripe webhook makes, over the feature's own
 * Postgres repository.
 *
 * The port answers `null` for exactly one thing: the row Stripe named is not
 * there. Prisma reports that as `P2025` and the lifecycle services already read
 * the `null` as "nothing to change". Every other failure is rethrown, because
 * the webhook maps an unhandled error to a 500 and a 500 is what makes Stripe
 * redeliver — swallowing a connection failure here would acknowledge a payment
 * whose plan change never landed.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger } from "@langwatch/observability";

import {
  BillingWebhookSubscriptionPort,
  type CancelledSubscription,
  type SubscriptionWithOrg,
} from "../billing-webhook-subscription.repository.ts";
import type {
  BillingSubscriptionRecord,
  SubscriptionRepository,
  BillingSubscriptionWithOrganization,
} from "../subscription.repository.ts";

const logger = createLogger("langwatch:billing:webhook-subscription-adapter");

/** The one organization column the port carries that the repository does not select. */
export type BillingWebhookTrialLicenseDatabase = Pick<PrismaClient, "organization">;

export class PrismaBillingWebhookSubscriptionRepository extends BillingWebhookSubscriptionPort {
  private constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly database: BillingWebhookTrialLicenseDatabase,
  ) {
    super();
  }

  static create(options: {
    subscriptions: SubscriptionRepository;
    database: BillingWebhookTrialLicenseDatabase;
  }): PrismaBillingWebhookSubscriptionRepository {
    return new PrismaBillingWebhookSubscriptionRepository(options.subscriptions, options.database);
  }

  tryFindLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.tryFindLastNonCancelled(organizationId);
  }

  tryCreatePending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord | null> {
    return this.orNull("createPending", () => this.subscriptions.createPending(input));
  }

  tryUpdateStatus(input: {
    id: string;
    status: string;
  }): Promise<BillingSubscriptionRecord | null> {
    return this.orNull("updateStatus", () => this.subscriptions.updateStatus(input));
  }

  tryUpdatePlan(input: { id: string; plan: string }): Promise<BillingSubscriptionRecord | null> {
    return this.orNull("updatePlan", () => this.subscriptions.updatePlan(input));
  }

  tryFindByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.tryFindByStripeId(stripeSubscriptionId);
  }

  linkStripeId(input: { id: string; stripeSubscriptionId: string }): Promise<{ count: number }> {
    return this.subscriptions.linkStripeId(input);
  }

  async tryActivate(input: {
    id: string;
    previousStatus: string;
  }): Promise<SubscriptionWithOrg | null> {
    const activated = await this.orNull("activate", () => this.subscriptions.activate(input));
    return activated ? await this.withTrialLicense(activated) : null;
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

  async tryUpdateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null> {
    const updated = await this.orNull("updateQuantities", () =>
      this.subscriptions.updateQuantities(input),
    );
    return updated ? await this.withTrialLicense(updated) : null;
  }

  /**
   * The trial licence a paid subscription retires, read beside the row rather
   * than selected with it: the repository's organization shape is shared with
   * every other billing surface, and none of the rest has any business with a
   * licence key.
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
}

/** Prisma's "an operation failed because it depends on one or more records that were required but not found". */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
