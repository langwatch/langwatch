// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuthzApi, PLATFORM_TENANT_ID } from "@langwatch/authz-contract";
import {
  BillingApi,
  billingBrowserConfig,
  billingConfig,
  BillingPriceCatalogue,
  billingSecrets,
  type BillingServerConfig,
  type BillingAuditRecordedEventData,
  type BillingStaff,
  type BillingDisplayInvoice,
  type ConnectedAddCommitRequest,
  type Currency,
  type SubscribablePlan,
  type SubscriptionBillingInterval,
  type CurrencyRequest,
  type DetectedCurrency,
  type ConnectedBillingAccountView,
  type ConnectedBillingOverview,
  ConnectedBillingUnavailableError,
  type ConnectedCreditGrantView,
  type ConnectedOnboardRequest,
  type ConnectedRenewRequest,
  getStripeEnvironmentFromNodeEnv,
  type RenewalCompletion,
  type ReportUsageForMonthCommandData,
  type ResourceLimitNotifierInput,
  type SubscriptionPlanInput,
  type BillingPricingModel,
  type UsageWarningDecision,
} from "@langwatch/enterprise-billing-contract";
import { LicensingApi, type PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type {
  EventingCommands,
  EventingCommandSender,
  EventingParticipation,
} from "@langwatch/eventing";
import { NotFoundError } from "@langwatch/handled-error";
import type { MailSender } from "@langwatch/mail";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import type { FeatureSetup } from "@langwatch/process";
import { fromDate, Temporal, type Instant } from "@langwatch/time";

import type { BillingStripeChannels } from "../channels/billing-stripe.channels.ts";
import { billingSubscriptionNotifierChannels } from "../channels/billing-subscription-notifier-channels.registry.ts";
import type { BillingSubscriptionNotifier } from "../channels/billing-subscription-notifier.channel.ts";
import { billingWebhookHostChannels } from "../channels/billing-webhook-host-channels.registry.ts";
import type { BillingWebhookHost } from "../channels/billing-webhook-host.channel.ts";
import { connectedStatementMailChannels } from "../channels/connected-statement-mail-channels.registry.ts";
import type { ConnectedStatementMailChannel } from "../channels/connected-statement-mail.channel.ts";
import { composeHttpBillingStripe } from "../channels/http/http.billing-stripe.channels.ts";
import { licenseEmailChannels } from "../channels/license-email-channels.registry.ts";
import { stripeWebhooksChannels } from "../channels/stripe-webhooks-channels.registry.ts";
import { usageLimitEmailChannels } from "../channels/usage-limit-email-channels.registry.ts";
import type { BillingLifecyclePipeline } from "../eventing/billing-lifecycle.pipeline.ts";
import {
  type BillingReportingDefinition,
  BillingReportingPipeline,
} from "../eventing/billing-reporting.pipeline.ts";
import { ConnectedBillingOverviewService } from "../features/connected-billing/services/connected-billing-overview.service.ts";
import { ConnectedBillingTickService } from "../features/connected-billing/services/connected-billing-tick.service.ts";
import { ConnectedBillingService } from "../features/connected-billing/services/connected-billing.service.ts";
import { ConnectedCustomerFactsService } from "../features/connected-billing/services/connected-customer-facts.service.ts";
import { ConnectedMonthlyStatementService } from "../features/connected-billing/services/connected-monthly-statement.service.ts";
import { ConnectedSeatChangeService } from "../features/connected-billing/services/connected-seat-change.service.ts";
import { ConnectedUsageCeilingService } from "../features/connected-billing/services/connected-usage-ceiling.service.ts";
import { LicensePurchaseDeliveryService } from "../features/license-purchase/services/license-purchase-delivery.service.ts";
import { LicensePurchaseService } from "../features/license-purchase/services/license-purchase.service.ts";
import { LicensingLicenseGeneratorService } from "../features/license-purchase/services/licensing-license-generator.service.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import { isStripeTestModeKey } from "../rules/stripe-mode.rules.ts";
import {
  planLimitCooldown,
  planLimitInFlight,
  resourceLimitCooldown,
} from "../services/billing-alert-cooldown.service.ts";
import { BillingErrorReporterService } from "../services/billing-error-reporter.service.ts";
import { BillingLifecycleAnnouncerService } from "../services/billing-lifecycle-announcer.service.ts";
import { StripeWebhookReceiptService } from "../services/billing-stripe-webhook-receipt.service.ts";
import {
  EEWebhookService,
  type LicensePurchaseHandler,
} from "../services/billing-stripe-webhook.service.ts";
import { NotificationService as BillingUsageNoticeService } from "../services/billing-usage-notice.service.ts";
import { CurrencyService } from "../services/currency.service.ts";
import { CustomerService } from "../services/customer.service.ts";
import { InstantEvalSpendQueryService } from "../services/instant-eval-spend-query.service.ts";
import { OrganizationPricingService } from "../services/organization-pricing.service.ts";
import { PlanLimitAlertService } from "../services/plan-limit-alert.service.ts";
import { SaaSPlanProviderService } from "../services/plan-provider.service.ts";
import { ResourceLimitAlertService } from "../services/resource-limit-alert.service.ts";
import { SeatEventSubscriptionService } from "../services/seat-event-subscription.service.ts";
import { StripeCustomerCurrencyService } from "../services/stripe-customer-currency.service.ts";
import { StripeErrorTranslatorService } from "../services/stripe-error-translator.service.ts";
import { SubscriptionItemCalculatorService } from "../services/subscription-item-calculator.service.ts";
import { BillingSubscriptionService } from "../services/subscription.service.ts";
import { UsageLimitOrganizationService } from "../services/usage-limit-organization.service.ts";
import {
  StripeUsageReportingBuilder,
  type UsageReportingService,
} from "../services/usage-reporting.service.ts";
import { UsageWarningService } from "../services/usage-warning.service.ts";
import type { BillingStripeWebhookApi } from "../transport/billing-stripe-webhook.rest.ts";
import type { BillingCurrencyApi } from "../transport/currency.trpc.ts";
import type { BillingSubscriber, BillingSubscriptionApi } from "../transport/subscription.trpc.ts";

/** Main's `env.BASE_HOST ?? "https://app.langwatch.ai"` for the usage link. */
const DEFAULT_PUBLIC_BASE_URL = "https://app.langwatch.ai";

type BillingSetup = FeatureSetup<
  typeof BillingModule.dependencies,
  BillingServerConfig,
  BillingRepositories
>;

/** The license registry's view of a customer's terms, budget, seats and hosted spend. */
type ConnectedLicensing = Pick<
  LicensingApi,
  | "getContractTerms"
  | "raiseContractCommit"
  | "syncContractBudget"
  | "resetContractBudget"
  | "getConnectedSeats"
  | "getHostedUsage"
  | "findSeatChanges"
>;

/** The peers connected billing reads and gates through, each only as wide as it is used. */
export type ConnectedBillingPeers = Readonly<{
  licensing: ConnectedLicensing;
  authorization: Pick<AuthzApi, "can">;
}>;

/** Where the plan-limit stamp goes: billing's fact, which organization applies (R42). */
type PlanLimitStamps = Pick<BillingLifecycleAnnouncerService, "planLimitAlertSent">;

/** Billing's Stripe, built once per deployment that holds the key. */
type BillingStripe = Readonly<{
  channels: BillingStripeChannels;
}>;

type StripeWebhookComposition = Readonly<{
  host: BillingWebhookHost;
  /** Main's licence purchase: signs, records, mails and announces; absent without the key. */
  licensePurchase?: LicensePurchaseHandler;
  /** Clears a trial's licence once its subscription activates; licensing owns it. */
  licenses: Pick<LicensingApi, "removeLicense">;
}>;

type SubscriptionComposition = Readonly<{
  notifier: BillingSubscriptionNotifier;
  /** Abandoned checkouts' held invitations close from billing's fact (R42). */
  facts: Pick<BillingLifecycleAnnouncerService, "seatCheckoutsAbandoned">;
}>;

type SubscriptionDoor = Readonly<{
  customers: CustomerService;
  subscriptions: BillingSubscriptionService;
}>;

type ConnectedBilling = Readonly<{
  billing: ConnectedBillingService;
  seats: ConnectedSeatChangeService;
  tick: ConnectedBillingTickService;
}>;

export class BillingModule
  implements BillingApi, BillingStripeWebhookApi, BillingCurrencyApi, BillingSubscriptionApi
{
  static readonly contract = BillingApi;
  static readonly dependencies = {
    /** The commit and the contract budget live on the license, not here. */
    licensing: LicensingApi,
    /** The platform-operator grant the admin console commands are checked against. */
    authorization: AuthzApi,
    /** Where the usage-limit warning is written down, and read back so it goes once a month. */
    notifications: NotificationApi,
  };
  static readonly config = billingConfig;
  static readonly publicConfig = billingBrowserConfig.project;
  static readonly secrets = {
    stripeSecretKey: billingSecrets.stripeSecretKey,
    stripeWebhookSecret: billingSecrets.stripeWebhookSecret,
    internalSlackPlanLimitWebhook: billingSecrets.internalSlackPlanLimitWebhook,
    internalSlackSubscriptionsWebhook: billingSecrets.internalSlackSubscriptionsWebhook,
    internalSlackSelfHostedWebhook: billingSecrets.internalSlackSelfHostedWebhook,
    internalSlackSignupsWebhook: billingSecrets.internalSlackSignupsWebhook,
  } as const;

  static async create(setup: BillingSetup): Promise<BillingModule> {
    const mailer: MailSender = {
      send: (content) => setup.dependencies.notifications.sendEmail(content),
    };
    const webhooks = await setup.secrets.into(
      BillingModule.secrets.stripeWebhookSecret,
      (signingSecret) => stripeWebhooksChannels.http.create({ signingSecret }),
    );
    const notices = await BillingModule.#composeNotices(setup);
    // Licensing holds the signing key and refuses a purchase it cannot sign.
    const licensePurchase = LicensePurchaseService.create({
      generateLicense: LicensingLicenseGeneratorService.create({
        licensing: setup.dependencies.licensing,
      }),
      delivery: LicensePurchaseDeliveryService.create({
        licensing: setup.dependencies.licensing,
        mail: licenseEmailChannels.ses.create(mailer),
        notices,
      }),
    });
    // The announcer subscribes the plan-limit alert, whose stamp is the announcer's own fact.
    const stamps: PlanLimitStamps = {
      planLimitAlertSent: (input) => lifecycle.planLimitAlertSent(input),
    };
    const resourceLimitAlerts = BillingModule.#composeResourceLimitAlerts(setup, notices, stamps);
    const lifecycle = BillingLifecycleAnnouncerService.create({
      subscriptions: setup.repositories.webhookSubscriptions,
      organizations: setup.repositories.organizations,
      resourceLimitAlerts,
      planLimitAlerts: BillingModule.#composePlanLimitAlerts(setup, notices, stamps),
      billingOrganizations: setup.repositories.reportOrganizations,
    });
    const { nodeEnvironment } = setup.config;
    return setup.secrets.into(BillingModule.secrets.stripeSecretKey, (secretKey) => {
      const stripe = secretKey
        ? BillingModule.#composeStripe({ secretKey, webhooks, nodeEnvironment })
        : void 0;
      return BillingModule.assemble({
        repositories: setup.repositories,
        config: setup.config,
        peers: setup.dependencies,
        stripe,
        usageReporting: () =>
          StripeUsageReportingBuilder.create({
            meters: stripe?.channels.meters,
            nodeEnvironment,
          }).build(),
        statementMail: connectedStatementMailChannels.ses.create(mailer),
        usageWarnings: BillingModule.#composeUsageWarnings(setup, notices, stamps),
        resourceLimitAlerts,
        lifecycle,
        webhook: {
          host: billingWebhookHostChannels.slack.create({ notices }),
          licenses: setup.dependencies.licensing,
          licensePurchase,
        },
        subscription: {
          notifier: billingSubscriptionNotifierChannels.slack.create({ notices }),
          facts: lifecycle,
        },
      });
    });
  }

  /** Every Stripe subject channel billing has, over the one client the http bundle builds. */
  static #composeStripe({
    secretKey,
    webhooks,
    nodeEnvironment,
  }: {
    secretKey: string;
    webhooks: BillingStripeChannels["webhooks"];
    nodeEnvironment: string | undefined;
  }): BillingStripe {
    return { channels: { webhooks, ...composeHttpBillingStripe({ secretKey, nodeEnvironment }) } };
  }

  /** Main's Slack, HubSpot and usage-limit mail notices; each Slack webhook is a secret. */
  static async #composeNotices(setup: BillingSetup): Promise<BillingUsageNoticeService> {
    const { config, secrets } = setup;
    const handles = BillingModule.secrets;
    return secrets.into(handles.stripeSecretKey, (stripeSecretKey) =>
      secrets.into(handles.internalSlackPlanLimitWebhook, (slackPlanLimitChannel) =>
        secrets.into(handles.internalSlackSubscriptionsWebhook, (slackSubscriptionsChannel) =>
          secrets.into(handles.internalSlackSignupsWebhook, (slackSignupsChannel) =>
            secrets.into(handles.internalSlackSelfHostedWebhook, (slackSelfHostedChannel) =>
              BillingUsageNoticeService.create({
                config: {
                  baseHost: setup.config.publicBaseUrl,
                  slackPlanLimitChannel,
                  slackSignupsChannel,
                  slackSelfHostedChannel,
                  slackSubscriptionsChannel,
                  stripeTestMode: isStripeTestModeKey({ secretKey: stripeSecretKey }),
                  hubspotPortalId: config.hubspotPortalId,
                  hubspotReachedLimitFormId: config.hubspotReachedLimitFormId,
                  hubspotFormId: config.hubspotFormId,
                },
                usageLimitEmail: usageLimitEmailChannels.ses.create({
                  send: (content) => setup.dependencies.notifications.sendEmail(content),
                }),
              }),
            ),
          ),
        ),
      ),
    );
  }

  /** Main's usage-limit warning as entitlement decides it, sent through notification. */
  static #composeUsageWarnings(
    setup: BillingSetup,
    notices: BillingUsageNoticeService,
    stamps: PlanLimitStamps,
  ): UsageWarningService {
    const { notifications } = setup.dependencies;
    const { projects, organizations } = setup.repositories;
    return UsageWarningService.create({
      records: notifications,
      organizations: UsageLimitOrganizationService.create({ organizations, projects, stamps }),
      emails: notices,
      baseHost: setup.config.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL,
    });
  }

  /** Main's resource-limit Slack alert, over the same notices and admin read as the warning. */
  static #composeResourceLimitAlerts(
    setup: BillingSetup,
    notices: BillingUsageNoticeService,
    stamps: PlanLimitStamps,
  ): ResourceLimitAlertService {
    const { projects, organizations } = setup.repositories;
    const { isSaas } = setup.config;
    return ResourceLimitAlertService.create({
      isSaas,
      cooldown: resourceLimitCooldown,
      organizations: UsageLimitOrganizationService.create({ organizations, projects, stamps }),
      plans: SaaSPlanProviderService.create({
        subscriptions: setup.repositories.subscriptions,
        isSaas,
      }),
      notices,
      errors: BillingErrorReporterService.create(),
    });
  }

  /** Main's plan-limit alert, guarded in flight, by the 30-day damper and the organization's stamp. */
  static #composePlanLimitAlerts(
    setup: BillingSetup,
    notices: BillingUsageNoticeService,
    stamps: PlanLimitStamps,
  ): PlanLimitAlertService {
    const { projects, organizations } = setup.repositories;
    return PlanLimitAlertService.create({
      isSaas: setup.config.isSaas,
      inFlight: planLimitInFlight,
      cooldown: planLimitCooldown,
      organizations: UsageLimitOrganizationService.create({ organizations, projects, stamps }),
      notices,
      errors: BillingErrorReporterService.create(),
    });
  }

  /** The construction once the payment provider's key has resolved, or not. */
  static assemble({
    repositories,
    config,
    peers,
    stripe,
    usageReporting,
    statementMail,
    usageWarnings,
    resourceLimitAlerts,
    webhook,
    subscription,
    lifecycle,
  }: {
    repositories: Pick<
      BillingRepositories,
      | "connectedBilling"
      | "checkpoints"
      | "reportOrganizations"
      | "organizationCache"
      | "subscriptions"
      | "organizationPricing"
      | "webhookSubscriptions"
      | "webhookOrganizations"
      | "seatEventSubscriptions"
      | "organizations"
      | "gatewaySpend"
      | "projects"
    >;
    config: Pick<
      BillingServerConfig,
      "bankDetails" | "licensePaymentLinkId" | "isSaas" | "nodeEnvironment"
    >;
    peers: ConnectedBillingPeers;
    /** Billing's Stripe; absent where the deployment holds no key, and nothing bills. */
    stripe?: BillingStripe;
    /** The meter LangWatch Cloud reports usage to, built on first use; it refuses without a key. */
    usageReporting: () => UsageReportingService;
    /** The monthly statement mail; absent, statements wait and nothing is recorded. */
    statementMail?: ConnectedStatementMailChannel;
    usageWarnings: UsageWarningService;
    resourceLimitAlerts: ResourceLimitAlertService;
    /** The Stripe callback's outside reach; absent, the callback answers 404. */
    webhook?: StripeWebhookComposition;
    /** Main's subscription door; absent, every `subscription.*` procedure answers not found. */
    subscription?: SubscriptionComposition;
    /** Records the checkout and subscription changes for peers; absent where a suite composes none. */
    lifecycle?: BillingLifecycleAnnouncerService;
  }): BillingModule {
    const { isSaas, nodeEnvironment } = config;
    const repository = repositories.connectedBilling;
    const facts = ConnectedCustomerFactsService.create({
      licensing: peers.licensing,
      organizations: repositories.organizations,
      gateway: repositories.gatewaySpend,
      projects: repositories.projects,
    });
    const overview = ConnectedBillingOverviewService.create({
      repository,
      facts,
      licensing: peers.licensing,
    });
    const gate = {
      authorization: peers.authorization,
      overview,
      subscriptionPlans: SaaSPlanProviderService.create({
        subscriptions: repositories.subscriptions,
        isSaas,
      }),
      isSaas,
      usageWarnings,
      resourceLimitAlerts,
      pricing: OrganizationPricingService.create(repositories.organizationPricing),
      reporting: BillingModule.#composeReporting({
        repositories,
        peers,
        facts,
        nodeEnvironment,
        usageReporting: isSaas ? usageReporting : void 0,
      }),
    };
    if (!stripe) {
      return new BillingModule({
        ...gate,
        lifecycle,
        connected: void 0,
        stripeWebhook: BillingModule.#undispatchedWebhook(),
        subscriptions: void 0,
      });
    }

    const invoicing = stripe.channels.connectedInvoicing;
    const { licensing } = peers;
    const billing = ConnectedBillingService.create({
      repository,
      invoicing,
      terms: {
        termsOf: (organizationId) => licensing.getContractTerms({ organizationId }),
        raiseCommit: async (input) => {
          await licensing.raiseContractCommit(input);
        },
        syncBudget: (input) => licensing.syncContractBudget(input),
        resetBudget: (input) => licensing.resetContractBudget(input),
      },
      isSaas,
      bankDetails: () => config.bankDetails ?? null,
    });
    const seats = ConnectedSeatChangeService.create({ repository, invoicing, licensing });

    return new BillingModule({
      ...gate,
      lifecycle,
      stripeWebhook: webhook
        ? BillingModule.#composeStripeWebhook({
            webhook,
            isSaas,
            stripe,
            nodeEnvironment,
            repositories,
            licensePaymentLinkId: config.licensePaymentLinkId,
            connectedBilling: billing,
            announcer: lifecycle,
          })
        : BillingModule.#undispatchedWebhook(),
      subscriptions:
        subscription && isSaas
          ? BillingModule.#composeSubscriptions({
              subscription,
              stripe,
              nodeEnvironment,
              repositories,
            })
          : void 0,
      connected: {
        billing,
        seats,
        tick: ConnectedBillingTickService.create({
          statements: statementMail
            ? ConnectedMonthlyStatementService.create({
                repository,
                sources: facts,
                mail: statementMail,
              })
            : void 0,
          renewals: billing,
          repository,
          customers: facts,
        }),
      },
    });
  }

  /** A deployment that composed no Stripe callback: every delivery answers 404. */
  static #undispatchedWebhook(): StripeWebhookReceiptService {
    return StripeWebhookReceiptService.create({
      dispatchesEvents: () => false,
      hasSigningSecret: () => false,
      constructEvent: () => {
        throw new Error("No Stripe callback is composed");
      },
      handleEvent: () => Promise.reject(new Error("No Stripe callback is composed")),
    });
  }

  /** Main's `createSubscriptionRouter` services: customers, subscriptions and seat checkouts. */
  static #composeSubscriptions({
    subscription,
    stripe,
    nodeEnvironment,
    repositories,
  }: {
    subscription: SubscriptionComposition;
    stripe: Pick<BillingStripe, "channels">;
    nodeEnvironment: string | undefined;
    repositories: Pick<
      BillingRepositories,
      "subscriptions" | "organizations" | "seatEventSubscriptions"
    >;
  }): SubscriptionDoor {
    const prices = BillingPriceCatalogue.create(
      getStripeEnvironmentFromNodeEnv(nodeEnvironment),
    ).prices;
    const stripeErrors = StripeErrorTranslatorService.create();
    const { customers, subscriptions: stripeSubscriptions } = stripe.channels;
    return {
      customers: CustomerService.create({ customers, organizations: repositories.organizations }),
      subscriptions: BillingSubscriptionService.create({
        repository: repositories.subscriptions,
        organizationRepository: repositories.organizations,
        stripeSubscriptions,
        stripeInvoices: stripe.channels.invoices,
        itemCalculator: SubscriptionItemCalculatorService.create(prices),
        seatEventService: SeatEventSubscriptionService.create({
          stripeSubscriptions,
          subscriptions: repositories.seatEventSubscriptions,
          abandoned: subscription.facts,
          prices,
          customerCurrency: StripeCustomerCurrencyService.create({ customers, stripeErrors }),
        }),
        notifier: subscription.notifier,
        stripeErrors,
      }),
    };
  }

  /** The subscription door, or not found where main mounted no subscription router. */
  get #subscriptionDoor(): SubscriptionDoor {
    if (!this.#subscriptions) {
      throw new NotFoundError("not_found", {
        resource: "Subscription service",
        id: "this deployment",
      });
    }
    return this.#subscriptions;
  }

  async getOrCreateCustomerId(input: {
    user: BillingSubscriber;
    organizationId: string;
  }): Promise<string> {
    return this.#subscriptionDoor.customers.getOrCreateCustomerId(input);
  }

  async updateSubscriptionItems(input: {
    organizationId: string;
    plan: SubscribablePlan;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
    quotedAt?: number;
  }): Promise<{ success: boolean }> {
    return this.#subscriptionDoor.subscriptions.updateSubscriptionItems(input);
  }

  async createOrUpdateSubscription(input: {
    organizationId: string;
    baseUrl: string;
    plan: SubscribablePlan;
    membersToAdd?: number;
    tracesToAdd?: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: SubscriptionBillingInterval;
  }): Promise<{ url: string | null }> {
    return this.#subscriptionDoor.subscriptions.createOrUpdateSubscription(input);
  }

  async createBillingPortalSession(input: {
    customerId: string;
    baseUrl: string;
    organizationId: string;
  }): Promise<{ url: string }> {
    return this.#subscriptionDoor.subscriptions.createBillingPortalSession(input);
  }

  async findLastNonCancelledSubscription(input: { organizationId: string }): Promise<unknown> {
    return this.#subscriptionDoor.subscriptions.findLastNonCancelledSubscription(
      input.organizationId,
    );
  }

  async previewProration(input: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<unknown> {
    return this.#subscriptionDoor.subscriptions.previewProration(input);
  }

  async notifyProspective(input: {
    organizationId: string;
    plan: SubscribablePlan;
    customerName?: string;
    customerEmail?: string;
    note?: string;
    /** The caller's own address; an account without one is refused by name. */
    actorEmail: string | null;
  }): Promise<unknown> {
    return this.#subscriptionDoor.subscriptions.notifyProspective(input);
  }

  async createSeatCheckout(input: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    currency?: Currency;
    billingInterval?: SubscriptionBillingInterval;
    customerEmail: string | null;
  }): Promise<{ url: string | null; subscriptionId: string }> {
    const { customerEmail, ...checkout } = input;
    const customerId = await this.getOrCreateCustomerId({
      user: { email: customerEmail },
      organizationId: input.organizationId,
    });
    return this.#subscriptionDoor.subscriptions.createSeatCheckout({ ...checkout, customerId });
  }

  async listInvoices(input: { organizationId: string }): Promise<BillingDisplayInvoice[]> {
    return this.#subscriptionDoor.subscriptions.listInvoices(input);
  }

  /** Main's `EEWebhookService` behind the callback, over billing's own rows. */
  static #composeStripeWebhook({
    webhook,
    isSaas,
    stripe,
    nodeEnvironment,
    repositories,
    licensePaymentLinkId,
    connectedBilling,
    announcer,
  }: {
    announcer: BillingLifecycleAnnouncerService | undefined;
    webhook: StripeWebhookComposition;
    isSaas: boolean;
    stripe: BillingStripe;
    nodeEnvironment: string | undefined;
    repositories: Pick<BillingRepositories, "webhookSubscriptions" | "webhookOrganizations">;
    licensePaymentLinkId: string | undefined;
    connectedBilling: ConnectedBillingService;
  }): StripeWebhookReceiptService {
    const prices = BillingPriceCatalogue.create(
      getStripeEnvironmentFromNodeEnv(nodeEnvironment),
    ).prices;
    const events = EEWebhookService.create({
      subscriptionRepository: repositories.webhookSubscriptions,
      organizationRepository: repositories.webhookOrganizations,
      stripeSubscriptions: stripe.channels.subscriptions,
      itemCalculator: SubscriptionItemCalculatorService.create(prices),
      licensePaymentLinkId,
      licenses: webhook.licenses,
      licensePurchaseHandler: webhook.licensePurchase,
      host: webhook.host,
      connectedBilling,
      ...(announcer ? { announcer } : {}),
    });
    return StripeWebhookReceiptService.create({
      dispatchesEvents: () => isSaas,
      hasSigningSecret: () => stripe.channels.webhooks.isConfigured(),
      constructEvent: (input) => stripe.channels.webhooks.constructEvent(input),
      handleEvent: (event) => events.handleEvent(event),
    });
  }

  /** Main mounted currency detection on LangWatch Cloud only; elsewhere the procedure is absent. */
  detectCurrency(request: CurrencyRequest): DetectedCurrency {
    if (!this.#isSaas) {
      throw new NotFoundError("not_found", {
        resource: "Currency detection",
        id: "this deployment",
      });
    }
    return CurrencyService.create().detect(request);
  }

  receiveStripeWebhook(input: {
    rawBody: Uint8Array;
    signature: string | undefined;
  }): Promise<{ received: true }> {
    return this.#stripeWebhook.receiveStripeWebhook(input);
  }

  readonly #stripeWebhook: StripeWebhookReceiptService;
  readonly #subscriptions: SubscriptionDoor | undefined;
  readonly #connected: ConnectedBilling | undefined;
  readonly #authorization: Pick<AuthzApi, "can">;
  readonly #overview: ConnectedBillingOverviewService;
  readonly #subscriptionPlans: SaaSPlanProviderService;
  readonly #isSaas: boolean;
  readonly #pricing: OrganizationPricingService;
  readonly #reporting: BillingReportingPipeline;
  readonly #usageWarnings: UsageWarningService;
  readonly #resourceLimitAlerts: ResourceLimitAlertService;
  readonly #lifecycle: BillingLifecycleAnnouncerService | undefined;

  private constructor({
    stripeWebhook,
    subscriptions,
    connected,
    authorization,
    overview,
    subscriptionPlans,
    isSaas,
    pricing,
    reporting,
    usageWarnings,
    resourceLimitAlerts,
    lifecycle,
  }: {
    lifecycle: BillingLifecycleAnnouncerService | undefined;
    stripeWebhook: StripeWebhookReceiptService;
    subscriptions: SubscriptionDoor | undefined;
    connected: ConnectedBilling | undefined;
    authorization: Pick<AuthzApi, "can">;
    overview: ConnectedBillingOverviewService;
    subscriptionPlans: SaaSPlanProviderService;
    isSaas: boolean;
    pricing: OrganizationPricingService;
    reporting: BillingReportingPipeline;
    usageWarnings: UsageWarningService;
    resourceLimitAlerts: ResourceLimitAlertService;
  }) {
    this.#stripeWebhook = stripeWebhook;
    this.#subscriptions = subscriptions;
    this.#connected = connected;
    this.#authorization = authorization;
    this.#overview = overview;
    this.#subscriptionPlans = subscriptionPlans;
    this.#isSaas = isSaas;
    this.#pricing = pricing;
    this.#reporting = reporting;
    this.#usageWarnings = usageWarnings;
    this.#resourceLimitAlerts = resourceLimitAlerts;
    this.#lifecycle = lifecycle;
  }

  notifyResourceLimitReached(input: ResourceLimitNotifierInput): Promise<void> {
    return this.#resourceLimitAlerts.notifyResourceLimitReached(input);
  }

  async sendUsageWarning(
    input: UsageWarningDecision,
  ): Promise<{ sent: boolean; notificationId?: string; sentAt?: Instant }> {
    const result = await this.#usageWarnings.send(input);
    if (result.outcome === "skipped") return { sent: false };
    return {
      sent: true,
      notificationId: result.notification.id,
      sentAt: fromDate(result.notification.sentAt),
    };
  }

  getPricingModel(input: {
    organizationId: string;
  }): Promise<{ pricingModel: BillingPricingModel | null }> {
    return this.#pricing.getPricingModel(input);
  }

  /** The pipeline `billing_lifecycle` registers, composed once by {@link create}. */
  lifecyclePipeline(): BillingLifecyclePipeline {
    if (!this.#lifecycle) {
      throw new Error("This billing app was composed without a lifecycle pipeline");
    }

    return this.#lifecycle.pipeline;
  }

  /** The usage-billing catch-up for one organization, for its hand-run task (ADR-174 decision 17). */
  async catchUpUsageBilling({
    organizationId,
    isDryRun = false,
  }: {
    organizationId: string;
    isDryRun?: boolean;
  }): Promise<{ usageBilled: boolean }> {
    if (!this.#lifecycle) {
      throw new Error("This billing app was composed without a lifecycle pipeline");
    }
    return this.#lifecycle.usageBillingCaughtUp({ organizationId, isDryRun });
  }

  /** Records billing's pricing-model fact, for the tiered-free-to-seat-event hand-run task. */
  async pricingModelChanged(input: {
    organizationId: string;
    pricingModel: BillingPricingModel;
  }): Promise<void> {
    if (!this.#lifecycle) {
      throw new Error("This billing app was composed without a lifecycle pipeline");
    }
    await this.#lifecycle.pricingModelChanged(input);
  }

  /** Binds the lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<BillingLifecyclePipeline>): void {
    if (!this.#lifecycle) {
      throw new Error("This billing app was composed without a lifecycle pipeline");
    }
    this.#lifecycle.connect(commands);
  }

  /** The command-only pipeline `billing_reporting` registers, composed once by {@link assemble}. */
  reportingPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): BillingReportingDefinition {
    return this.#reporting.buildProcessing({ participation });
  }

  /** Closes the roll-up's self re-dispatch over the registered sender. */
  connectReporting(
    reportUsageForMonth: EventingCommandSender<ReportUsageForMonthCommandData>,
  ): void {
    this.#reporting.connectSelfDispatch(async (data) => {
      await reportUsageForMonth.send(data);
    });
  }

  static #composeReporting({
    repositories,
    peers,
    facts,
    usageReporting,
    nodeEnvironment,
  }: {
    repositories: Pick<
      BillingRepositories,
      "checkpoints" | "reportOrganizations" | "organizationCache" | "gatewaySpend"
    >;
    peers: Pick<ConnectedBillingPeers, "licensing">;
    facts: ConnectedCustomerFactsService;
    usageReporting: (() => UsageReportingService) | undefined;
    nodeEnvironment: string | undefined;
  }): BillingReportingPipeline {
    const projects = {
      findProjectIds: (organizationId: string) => facts.findProjectIds(organizationId),
    };
    const instantEvalSpend = InstantEvalSpendQueryService.create({
      isSpendSourceAvailable: () => repositories.gatewaySpend.isSpendSourceAvailable(),
      listProjectIds: ({ organizationId }) => projects.findProjectIds(organizationId),
      sumSpendNanoUsdByRequestType: (input) =>
        repositories.gatewaySpend.sumSpendNanoUsdByRequestType(input),
    });
    const ceiling = ConnectedUsageCeilingService.create({
      licensing: peers.licensing,
      gateway: repositories.gatewaySpend,
      projects,
    });
    let reporter: UsageReportingService | undefined;

    return BillingReportingPipeline.create({
      organizations: repositories.reportOrganizations,
      billingCheckpoints: repositories.checkpoints,
      getUsageReportingService: () => (reporter ??= usageReporting?.()),
      queryInstantEvalSpendTotal: (input) => instantEvalSpend.queryInstantEvalSpendTotal(input),
      isInstantEvalMeterProvisioned: () =>
        BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(nodeEnvironment)).meters
          .INSTANT_EVAL_USD !== undefined,
      organizationCache: repositories.organizationCache,
      errorReporter: BillingErrorReporterService.create(),
      connectedUsageCeiling: async (input) => {
        const answer = await ceiling.getRemaining(input);
        return answer.kind === "capped" ? answer.remainingUnits : null;
      },
    });
  }

  /** Main's composite recomputed `overrideAddingLimitations` from the impersonator. */
  async getActiveSubscriptionPlan({
    organizationId,
    user,
  }: SubscriptionPlanInput): Promise<PlanInfo> {
    const plan = await this.#subscriptionPlans.getActivePlan(organizationId);
    const impersonatorId = user?.impersonator?.id;

    return {
      ...plan,
      overrideAddingLimitations:
        !!impersonatorId &&
        (await this.#authorization.can({
          principal: { type: "user", id: impersonatorId },
          permission: "ops:view",
          scope: { type: "platform" },
        })),
    };
  }

  async getConnectedBillingOverview(
    input: { organizationId: string },
    staff: BillingStaff,
  ): Promise<ConnectedBillingOverview> {
    await this.#record({
      staff,
      action: "connectedBilling.get",
      args: { organizationId: input.organizationId },
      organizationId: input.organizationId,
    });
    return this.#overview.getOverview(input);
  }

  async onboardConnectedCustomer(
    input: ConnectedOnboardRequest,
    staff: BillingStaff,
  ): Promise<ConnectedBillingAccountView> {
    const account = await this.#connectedBilling().billing.onboard({
      ...input,
      termStartsAt: Temporal.Instant.from(input.termStartsAt),
      termEndsAt: Temporal.Instant.from(input.termEndsAt),
      operatorId: staff.id,
    });
    // Onboarding opens the account and its usage subscription, which the meter's rule reads.
    await this.#lifecycle?.usageBillingChanged({ organizationId: input.organizationId });
    await this.#record({
      staff,
      action: "connectedBilling.onboard",
      args: {
        organizationId: input.organizationId,
        seats: input.seats,
        commitUsdCents: input.commitUsdCents,
        termEndsAt: input.termEndsAt,
      },
      organizationId: input.organizationId,
    });
    return this.#overview.viewAccount(account);
  }

  async addConnectedCommit(
    input: ConnectedAddCommitRequest,
    staff: BillingStaff,
  ): Promise<ConnectedCreditGrantView> {
    const grant = await this.#connectedBilling().billing.addCommit({
      ...input,
      operatorId: staff.id,
    });
    await this.#record({
      staff,
      action: "connectedBilling.addCommit",
      args: { organizationId: input.organizationId, amountUsdCents: input.amountUsdCents },
      organizationId: input.organizationId,
    });
    return this.#overview.viewCreditGrant(grant);
  }

  async renewConnectedTerm(
    input: ConnectedRenewRequest,
    staff: BillingStaff,
  ): Promise<ConnectedBillingAccountView> {
    const account = await this.#connectedBilling().billing.renew({
      ...input,
      termStartsAt: Temporal.Instant.from(input.termStartsAt),
      termEndsAt: Temporal.Instant.from(input.termEndsAt),
      operatorId: staff.id,
    });
    await this.#record({
      staff,
      action: "connectedBilling.renew",
      args: {
        organizationId: input.organizationId,
        commitUsdCents: input.commitUsdCents,
        termEndsAt: input.termEndsAt,
      },
      organizationId: input.organizationId,
    });
    return this.#overview.viewAccount(account);
  }

  async completeConnectedRenewalIfDue(
    input: { organizationId: string },
    staff: BillingStaff,
  ): Promise<RenewalCompletion> {
    const outcome = await this.#connectedBilling().billing.completeRenewalIfDue(input);
    await this.#record({
      staff,
      action: "connectedBilling.completeRenewalIfDue",
      args: { organizationId: input.organizationId, outcome },
      organizationId: input.organizationId,
    });
    return outcome;
  }

  async markConnectedInvoicePaidOutOfBand(
    input: { stripeInvoiceId: string },
    staff: BillingStaff,
  ): Promise<void> {
    await this.#connectedBilling().billing.markPaidOutOfBand(input);
    await this.#audited().audited({
      tenantId: PLATFORM_TENANT_ID,
      userId: staff.id,
      action: "connectedBilling.markPaidOutOfBand",
      args: { stripeInvoiceId: input.stripeInvoiceId },
      targetKind: "invoice",
      targetId: input.stripeInvoiceId,
    });
  }

  async #record({
    staff,
    action,
    args,
    organizationId,
  }: {
    staff: BillingStaff;
    action: string;
    args: BillingAuditRecordedEventData["args"];
    organizationId: string;
  }): Promise<void> {
    await this.#audited().audited({
      tenantId: organizationId,
      userId: staff.id,
      action,
      args,
      targetKind: "organization",
      targetId: organizationId,
    });
  }

  /** Audit-log writes each admin console command's row from billing's fact (round 37 D3). */
  #audited(): BillingLifecycleAnnouncerService {
    if (!this.#lifecycle) {
      throw new Error("This billing app was composed without a lifecycle pipeline");
    }
    return this.#lifecycle;
  }

  /** Every row it reads and every invoice it raises is Cloud's: an install runs nothing. */
  async invoicePendingSeatChanges(): Promise<void> {
    if (!this.#isSaas) return;
    await this.#connectedBilling().seats.invoicePendingSeatChanges();
  }

  /** Every row it reads and every invoice it raises is Cloud's: an install runs nothing. */
  async runConnectedBillingTick(): Promise<void> {
    if (!this.#isSaas) return;
    await this.#connectedBilling().tick.run();
  }

  /** Off Cloud nothing is invoiced; on Cloud a missing payment key is a deployment fault. */
  #connectedBilling(): ConnectedBilling {
    if (this.#connected) return this.#connected;
    if (!this.#isSaas) throw new ConnectedBillingUnavailableError();

    throw new Error("Connected billing needs the payment provider's secret key.");
  }
}
