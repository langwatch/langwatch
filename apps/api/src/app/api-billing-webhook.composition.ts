/**
 * `POST /api/webhooks/stripe`, and the SaaS billing write path behind it.
 *
 * The route is mounted on every deployment, exactly as the retired platform
 * application mounted it: a deployment that bills through nobody answers 404
 * there rather than serving a path that appears and disappears with a
 * credential. What the credential decides is whether there is a dispatcher
 * behind the door — and, with it, whether `subscription.*` can start a checkout
 * at all.
 *
 * One Stripe client for both halves. The webhook and the console's own
 * subscription surface act on the same customer and the same subscription, and
 * a second client would be a second idempotency scope over one account.
 */
import type { DataRetentionApi, RetentionCategory } from "@langwatch/data-retention-contract";
import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
  type SubscriptionNotificationPayload,
} from "@langwatch/enterprise-billing-contract";
import {
  BillingSubscriptionNotifierPort,
  BillingSubscriptionService,
  BillingWebhookHostPort,
  CurrencyService,
  CustomerService,
  EEWebhookService,
  LicenseGenerator,
  LicensePurchaseDelivery,
  LicensePurchaseService,
  NotificationService,
  NullBillingSubscriptionNotifierAdapter,
  PostgresBillingAdapter,
  PostgresBillingWebhookOrganizationAdapter,
  PostgresBillingWebhookSubscriptionAdapter,
  SeatEventSubscriptionService,
  SeatSyncService,
  SilentBillingWebhookHost,
  StripeCustomerCurrencyService,
  StripeErrorAdapter,
  SubscriptionItemCalculatorService,
  createBillingStripeClient,
  type BillingStripeWebhookApi,
  type BillingSubscriptionApi,
  type GeneratedLicense,
  type InviteApprover,
  type LicenseEmailDelivery,
  type LicensePurchaseNotification,
  type WebhookService,
} from "@langwatch/enterprise-billing-server";
import {
  LicenseGenerationService,
  NodeLicenseCryptographyAdapter,
} from "@langwatch/enterprise-licensing-server";
import { sendLicenseEmail } from "@langwatch/mail";
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type Stripe from "stripe";

import type { ApiBillingConfig } from "../platform/config/api.config.ts";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context.ts";
import type { ApiMailComposition } from "./api-mail.composition.ts";

const logger = createLogger("langwatch:api:billing-webhook");

/** The tier a self-hosted licence is sold on, as the payment link sells it. */
const LICENSE_PLAN_TYPE = "GROWTH";

export type ApiBillingWebhookComposition = Readonly<{
  /**
   * What `POST /api/webhooks/stripe` asks of this deployment. Always answered:
   * the door is mounted everywhere and reports 404 where nothing dispatches.
   */
  webhook: BillingStripeWebhookApi;
  /**
   * The two slices `currency.*` and `subscription.*` read off `ctx.app`. The
   * subscription half is absent where this deployment composed no Stripe, which
   * is what makes the surface say so plainly instead of pretending to bill.
   */
  application: Pick<ApiTrpcFeatureApplication, "billingCurrency" | "billingSubscription">;
  /**
   * Raises the seat line on a live seat-priced subscription when membership
   * changes. Absent without Stripe.
   */
  seatSync: SeatSyncService | undefined;
}>;

export type ApiBillingWebhookOptions = Readonly<{
  /** Absent on OSS and self-hosted: the route is mounted and answers 404. */
  billing: ApiBillingConfig | undefined;
  /** The one guarded connection every subscription and organization row is read on. */
  prisma: PrismaClient | undefined;
  /** The organization directory a Stripe customer is claimed against. */
  organizations:
    | Pick<OrganizationService, "getBillingProfile" | "claimBillingCustomerId">
    | undefined;
  /** The retention cascade a first paid seat subscription writes a default into. */
  dataRetention?: DataRetentionApi | undefined;
  /** The gateway the licence mail is sent through; absent sends no licence mail. */
  mail?: ApiMailComposition | undefined;
  /**
   * Approves the invitations a checkout was started to pay for. Absent leaves
   * them pending, which is what the checkout service already reports.
   */
  inviteApprover?: InviteApprover | undefined;
}>;

/**
 * Composes the Stripe webhook and everything it writes through.
 */
export function composeApiBillingWebhook(
  options: ApiBillingWebhookOptions,
): ApiBillingWebhookComposition {
  const composed = composeBillingWriteHalf(options);
  const currencies = CurrencyService.create();

  return {
    webhook: {
      dispatchesEvents: () => composed !== undefined,
      signingSecret: () => options.billing?.stripeWebhookSecret,
      constructEvent: ({ rawBody, signature }) => {
        if (!composed) throw new Error("This deployment composed no Stripe client");

        return composed.stripe.webhooks.constructEvent(
          Buffer.from(rawBody),
          signature,
          options.billing?.stripeWebhookSecret ?? "",
        );
      },
      handleEvent: (event) => {
        if (!composed) throw new Error("This deployment composed no Stripe client");

        return composed.webhooks.handleEvent(event);
      },
    },
    application: {
      billingCurrency: { detectCurrency: (request) => currencies.detect(request) },
      ...(composed
        ? { billingSubscription: billingSubscriptionOf(composed) }
        : {}),
    },
    seatSync: composed?.seatSync,
  };
}

/**
 * `subscription.*`'s one application, assembled from the two services behind
 * it: the provider customer a checkout is opened for, and the subscription that
 * checkout creates or raises.
 */
function billingSubscriptionOf(composed: ComposedBillingWriteHalf): BillingSubscriptionApi {
  const { customers, subscription } = composed;

  return {
    getOrCreateCustomerId: (input) => customers.getOrCreateCustomerId(input),
    updateSubscriptionItems: (input) => subscription.updateSubscriptionItems(input),
    createOrUpdateSubscription: (input) => subscription.createOrUpdateSubscription(input),
    createBillingPortalSession: (input) => subscription.createBillingPortalSession(input),
    findLastNonCancelledSubscription: (input) =>
      subscription.tryGetLastNonCancelledSubscription(input.organizationId),
    previewProration: (input) => subscription.previewProration(input),
    notifyProspective: (input) => subscription.notifyProspective(input),
    createSubscriptionWithInvites: (input) =>
      subscription.createSubscriptionWithInvites({ ...input, invites: [...input.invites] }),
    listInvoices: (input) => subscription.listInvoices(input),
  };
}

type ComposedBillingWriteHalf = Readonly<{
  stripe: Stripe;
  webhooks: WebhookService;
  subscription: BillingSubscriptionService;
  customers: CustomerService;
  seatSync: SeatSyncService;
}>;

/**
 * Everything behind the door, or nothing at all. The three collaborators are
 * demanded together on purpose: a Stripe client with no database writes
 * charges nobody's plan into anything, and reporting one absence at a time
 * would leave a half-built path answering some events and dropping others.
 */
function composeBillingWriteHalf(
  options: ApiBillingWebhookOptions,
): ComposedBillingWriteHalf | undefined {
  const { billing, prisma, organizations } = options;
  if (!billing) {
    logger.info(
      "Stripe is not configured: /api/webhooks/stripe answers 404 and the subscription surface reports that this deployment does not bill.",
    );
    return undefined;
  }
  if (!prisma || !organizations) {
    logger.warn(
      { prisma: !!prisma, organizations: !!organizations },
      "Stripe is configured but this process opened no database: no plan change can be written, so the webhook stays closed.",
    );
    return undefined;
  }

  const stripe = createBillingStripeClient({ secretKey: billing.stripeSecretKey });
  const catalogue = BillingPriceCatalogue.create(
    getStripeEnvironmentFromNodeEnv(process.env.NODE_ENV),
  );
  const persistence = PostgresBillingAdapter.create(prisma).build();
  const stripeErrors = StripeErrorAdapter.create();
  const itemCalculator = SubscriptionItemCalculatorService.create(catalogue.prices);
  const seatEvents = SeatEventSubscriptionService.create({
    stripe,
    database: prisma,
    prices: catalogue.prices,
    customerCurrency: StripeCustomerCurrencyService.create(stripeErrors),
  });
  const notifications = NotificationService.create({
    config: {
      ...(billing.slackSubscriptionsChannel
        ? { slackSubscriptionsChannel: billing.slackSubscriptionsChannel }
        : {}),
    },
  });

  return {
    stripe,
    webhooks: EEWebhookService.create({
      subscriptionRepository: PostgresBillingWebhookSubscriptionAdapter.create({
        subscriptions: persistence.subscriptions,
        database: prisma,
      }),
      organizationRepository: PostgresBillingWebhookOrganizationAdapter.create({
        database: prisma,
      }),
      stripe,
      itemCalculator,
      host: composeBillingWebhookHost({
        notifications,
        dataRetention: options.dataRetention,
      }),
      ...(options.inviteApprover ? { inviteApprover: options.inviteApprover } : {}),
      ...(billing.licensePaymentLinkId
        ? { licensePaymentLinkId: billing.licensePaymentLinkId }
        : {}),
      ...(billing.licensePrivateKey ? { licensePrivateKey: billing.licensePrivateKey } : {}),
      ...(options.mail
        ? {
            licensePurchaseHandler: LicensePurchaseService.create({
              delivery: ApiLicensePurchaseDelivery.create({
                mail: options.mail,
                notifications,
              }),
              generateLicense: ApiLicenseGenerator.create(
                LicenseGenerationService.create(NodeLicenseCryptographyAdapter.create()),
              ),
            }),
          }
        : {}),
    }),
    subscription: BillingSubscriptionService.create({
      repository: persistence.subscriptions,
      organizationRepository: persistence.organization,
      stripe,
      itemCalculator,
      seatEventService: seatEvents,
      // The operators' channel is the only delivery the retired application
      // ever wired here; without a channel named there is nowhere to send.
      notifier: billing.slackSubscriptionsChannel
        ? ApiBillingSubscriptionNotifier.create(notifications)
        : NullBillingSubscriptionNotifierAdapter.create(),
      stripeErrors,
    }),
    customers: CustomerService.create({ stripe, organizations }),
    seatSync: SeatSyncService.create({
      seatEvents,
      organizations: persistence.organizationPricing,
    }),
  };
}

/**
 * The two things a webhook reaches outside billing, where this process composed
 * them. Neither is required: an unsent Slack line and an unwritten retention
 * default are not reasons to make Stripe retry a payment it already took.
 */
function composeBillingWebhookHost(options: {
  notifications: NotificationService;
  dataRetention: DataRetentionApi | undefined;
}): BillingWebhookHostPort {
  if (!options.dataRetention) {
    logger.warn(
      "No data-retention service composed: a first paid seat subscription will not be given the platform retention default.",
    );
    return new SilentBillingWebhookHost();
  }
  return ApiBillingWebhookHost.create({
    notifications: options.notifications,
    dataRetention: options.dataRetention,
  });
}

/** The operators' Slack channel and the retention cascade, as the webhook reaches them. */
class ApiBillingWebhookHost extends BillingWebhookHostPort {
  static create(options: {
    notifications: NotificationService;
    dataRetention: DataRetentionApi;
  }): ApiBillingWebhookHost {
    return new ApiBillingWebhookHost(options.notifications, options.dataRetention);
  }

  private constructor(
    private readonly notifications: NotificationService,
    private readonly dataRetention: DataRetentionApi,
  ) {
    super();
  }

  async sendSlackSubscriptionEvent(payload: SubscriptionNotificationPayload): Promise<void> {
    await this.notifications.sendSlackSubscriptionEvent(payload);
  }

  async sendSlackBillingThresholdFailureAlert(input: {
    stripeSubscriptionId: string;
    reason: string;
  }): Promise<void> {
    await this.notifications.sendSlackBillingThresholdFailureAlert(input);
  }

  async listOrganizationRetentionRules(input: {
    organizationId: string;
  }): Promise<Array<{ scopeType: string; scopeId: string; category: string }>> {
    return await this.dataRetention.listOrganizationRules(input);
  }

  async setOrganizationRetention(input: {
    scope: { scopeType: "ORGANIZATION"; scopeId: string };
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<void> {
    await this.dataRetention.setForScope({
      scope: input.scope,
      category: input.category,
      retentionDays: input.retentionDays,
    });
  }
}

/** A subscription notice, over the same Slack channel the webhook alerts on. */
class ApiBillingSubscriptionNotifier extends BillingSubscriptionNotifierPort {
  static create(notifications: NotificationService): ApiBillingSubscriptionNotifier {
    return new ApiBillingSubscriptionNotifier(notifications);
  }

  private constructor(private readonly notifications: NotificationService) {
    super();
  }

  async send(payload: SubscriptionNotificationPayload): Promise<void> {
    await this.notifications.sendSlackSubscriptionEvent(payload);
  }
}

/**
 * Mints the key a licence purchase buys. The tier is the one the payment link
 * sells; nothing on the checkout session names it, so it is stated here rather
 * than read out of a customer-controlled field.
 */
class ApiLicenseGenerator extends LicenseGenerator {
  static create(licenses: LicenseGenerationService): ApiLicenseGenerator {
    return new ApiLicenseGenerator(licenses);
  }

  private constructor(private readonly licenses: LicenseGenerationService) {
    super();
  }

  generate(input: {
    organizationName: string;
    email: string;
    maxMembers: number;
    privateKey: string;
  }): GeneratedLicense {
    return this.licenses.generate({ ...input, planType: LICENSE_PLAN_TYPE });
  }
}

/** The licence mail and the sales channel a purchase is announced on. */
class ApiLicensePurchaseDelivery extends LicensePurchaseDelivery {
  static create(options: {
    mail: ApiMailComposition;
    notifications: NotificationService;
  }): ApiLicensePurchaseDelivery {
    return new ApiLicensePurchaseDelivery(options.mail, options.notifications);
  }

  private constructor(
    private readonly mail: ApiMailComposition,
    private readonly notifications: NotificationService,
  ) {
    super();
  }

  async sendLicenseEmail(input: LicenseEmailDelivery): Promise<void> {
    await sendLicenseEmail({ mailer: this.mail.delivery, ...input });
  }

  async notifyLicensePurchase(input: LicensePurchaseNotification): Promise<void> {
    await this.notifications.sendSlackLicensePurchase(input);
  }
}
