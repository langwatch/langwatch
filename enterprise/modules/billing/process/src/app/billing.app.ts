// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  BillingApi,
  billingBrowserConfig,
  billingConfig,
  BillingPriceCatalogue,
  billingSecrets,
  type BillingServerConfig,
  type BillingStaff,
  type BillingDisplayInvoice,
  type ConnectedAddCommitRequest,
  type Currency,
  type SubscribablePlan,
  type SubscriptionBillingInterval,
  type SubscriptionInvite,
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
  type USAGE_UNKNOWN,
  type UsageWarningDecision,
} from "@langwatch/enterprise-billing-contract";
import { LicensingApi, type PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type {
  EventingCommands,
  EventingCommandSender,
  EventingParticipation,
} from "@langwatch/eventing";
import { GatewayApi } from "@langwatch/gateway-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { MailSender } from "@langwatch/mail";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { AdminSurfaceHiddenError, type OpsOperatorPermission } from "@langwatch/ops-contract";
import { OrganizationApi, type OrganizationCaller } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { fromDate, Temporal, type Instant } from "@langwatch/time";
import Stripe from "stripe";

import { billingSubscriptionNotifierChannels } from "../channels/billing-subscription-notifier-channels.registry.ts";
import type { BillingSubscriptionNotifier } from "../channels/billing-subscription-notifier.channel.ts";
import { billingWebhookHostChannels } from "../channels/billing-webhook-host-channels.registry.ts";
import type { BillingWebhookHost } from "../channels/billing-webhook-host.channel.ts";
import { connectedInvoicingChannels } from "../channels/connected-invoicing-channels.registry.ts";
import { connectedStatementMailChannels } from "../channels/connected-statement-mail-channels.registry.ts";
import type { ConnectedStatementMailChannel } from "../channels/connected-statement-mail.channel.ts";
import { licenseEmailChannels } from "../channels/license-email-channels.registry.ts";
import { usageLimitEmailChannels } from "../channels/usage-limit-email-channels.registry.ts";
import type { BillingLifecyclePipeline } from "../eventing/billing-lifecycle.pipeline.ts";
import {
  type BillingReportingDefinition,
  BillingReportingPipeline,
} from "../eventing/billing-reporting.pipeline.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import { isStripeTestModeKey } from "../rules/stripe-mode.rules.ts";
import { BillableEventsQueryService } from "../services/billable-events-query.service.ts";
import { resourceLimitCooldown } from "../services/billing-alert-cooldown.service.ts";
import { BillingErrorReporterService } from "../services/billing-error-reporter.service.ts";
import { BillingLifecycleAnnouncerService } from "../services/billing-lifecycle-announcer.service.ts";
import { StripeWebhookReceiptService } from "../services/billing-stripe-webhook-receipt.service.ts";
import {
  EEWebhookService,
  type LicensePurchaseHandler,
} from "../services/billing-stripe-webhook.service.ts";
import type { SeatRetentionRules } from "../services/billing-subscription-lifecycle.service.ts";
import { NotificationService as BillingUsageNoticeService } from "../services/billing-usage-notice.service.ts";
import { ConnectedBillingOverviewService } from "../services/connected-billing-overview.service.ts";
import { ConnectedBillingTickService } from "../services/connected-billing-tick.service.ts";
import { ConnectedBillingService } from "../services/connected-billing.service.ts";
import {
  type ConnectedCustomerPeers,
  ConnectedCustomerFactsService,
} from "../services/connected-customer-facts.service.ts";
import { ConnectedMonthlyStatementService } from "../services/connected-monthly-statement.service.ts";
import { ConnectedSeatChangeService } from "../services/connected-seat-change.service.ts";
import { ConnectedUsageCeilingService } from "../services/connected-usage-ceiling.service.ts";
import { CurrencyService } from "../services/currency.service.ts";
import { CustomerService } from "../services/customer.service.ts";
import { InstantEvalSpendQueryService } from "../services/instant-eval-spend-query.service.ts";
import { LicensePurchaseDeliveryService } from "../services/license-purchase-delivery.service.ts";
import { LicensePurchaseService } from "../services/license-purchase.service.ts";
import { LicensingLicenseGeneratorService } from "../services/licensing-license-generator.service.ts";
import { OrganizationPricingService } from "../services/organization-pricing.service.ts";
import { SaaSPlanProviderService } from "../services/plan-provider.service.ts";
import { ResourceLimitAlertService } from "../services/resource-limit-alert.service.ts";
import { SeatEventSubscriptionService } from "../services/seat-event-subscription.service.ts";
import { StripeCustomerCurrencyService } from "../services/stripe-customer-currency.service.ts";
import { StripeErrorTranslatorService } from "../services/stripe-error-translator.service.ts";
import { StripeWebhookSignatureService } from "../services/stripe-webhook-signature.service.ts";
import { SubscriptionItemCalculatorService } from "../services/subscription-item-calculator.service.ts";
import { BillingSubscriptionService } from "../services/subscription.service.ts";
import { BillingTenantOrganizationService } from "../services/tenant-organization.service.ts";
import { UsageLimitOrganizationService } from "../services/usage-limit-organization.service.ts";
import {
  StripeUsageReportingBuilder,
  type UsageReportingService,
} from "../services/usage-reporting.service.ts";
import { UsageWarningService } from "../services/usage-warning.service.ts";
import type { BillingStripeWebhookApi } from "../transport/billing-stripe-webhook.rest.ts";
import type { BillingCurrencyApi } from "../transport/currency.trpc.ts";
import type { BillingSubscriber, BillingSubscriptionApi } from "../transport/subscription.trpc.ts";

/** Both are the process's own facts: where it runs, and which price mode it bills in. */
type BillingMembers = Readonly<{ isSaas: boolean; nodeEnvironment: string | undefined }>;

/** Main's `env.BASE_HOST ?? "https://app.langwatch.ai"` for the usage link. */
const DEFAULT_PUBLIC_BASE_URL = "https://app.langwatch.ai";

type BillingSetup = FeatureSetup<
  typeof BillingModule.dependencies,
  BillingMembers & Readonly<{ publicBaseUrl: string | undefined }>,
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
  auditLog: Pick<AuditLogApi, "record">;
  organizations: ConnectedCustomerPeers["organizations"];
  gateway: ConnectedCustomerPeers["gateway"];
}>;

/** Stripe API version this callback's client speaks, as the rest of billing pins it. */
const STRIPE_API_VERSION = "2024-04-10";

type StripeWebhookComposition = Readonly<{
  signing: StripeWebhookSignatureService;
  host: BillingWebhookHost;
  /** Data-retention's rules, which a first seat activation stamps at the platform default. */
  retention: SeatRetentionRules;
  /** Main's licence purchase: signs, records, mails and announces; absent without the key. */
  licensePurchase?: LicensePurchaseHandler;
  /** Opens the invitations a seat checkout paid for; organization owns them. */
  invites?: Pick<OrganizationApi, "approvePaymentPendingInvites">;
}>;

type SubscriptionComposition = Readonly<{
  notifier: BillingSubscriptionNotifier;
  organizations: Pick<
    OrganizationApi,
    | "getBillingProfile"
    | "claimBillingCustomerId"
    | "checkInvitesWithinCaller"
    | "createPaymentPendingInvites"
    | "cancelPaymentPendingInvites"
  >;
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
    /** The platform-operator grant the backoffice commands are checked against. */
    authorization: AuthzApi,
    /** Which organizations are connected customers, and their projects. */
    organizations: OrganizationApi,
    /** The spend ledger a statement sums. */
    gateway: GatewayApi,
    /** Where every backoffice billing command is recorded, as main recorded it. */
    auditLog: AuditLogApi,
    /** Where the usage-limit warning is written down, and read back so it goes once a month. */
    notifications: NotificationApi,
    /** The named projects a usage-limit warning lists. */
    projects: ProjectApi,
    /** The retention window a plan change resets, as main's webhook did. */
    dataRetention: DataRetentionApi,
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
  static readonly reads = ["isSaas", "nodeEnvironment", "publicBaseUrl"] as const;

  static async create(setup: BillingSetup): Promise<BillingModule> {
    const mailer: MailSender = {
      send: (content) => setup.dependencies.notifications.sendEmail(content),
    };
    const signing = await setup.secrets.into(BillingModule.secrets.stripeWebhookSecret, (secret) =>
      StripeWebhookSignatureService.create(secret),
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
    return setup.secrets.into(BillingModule.secrets.stripeSecretKey, (stripeSecretKey) =>
      BillingModule.assemble({
        members: setup.members,
        repositories: setup.repositories,
        config: setup.config,
        peers: setup.dependencies,
        stripeSecretKey,
        statementMail: connectedStatementMailChannels.ses.create(mailer),
        usageWarnings: BillingModule.#composeUsageWarnings(setup, notices),
        resourceLimitAlerts: BillingModule.#composeResourceLimitAlerts(setup, notices),
        lifecycle: BillingLifecycleAnnouncerService.create({
          subscriptions: setup.repositories.webhookSubscriptions,
          organizations: setup.dependencies.organizations,
        }),
        webhook: {
          signing,
          host: billingWebhookHostChannels.slack.create({ notices }),
          retention: setup.dependencies.dataRetention,
          invites: setup.dependencies.organizations,
          licensePurchase,
        },
        subscription: {
          notifier: billingSubscriptionNotifierChannels.slack.create({ notices }),
          organizations: setup.dependencies.organizations,
        },
      }),
    );
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
                  baseHost: setup.members.publicBaseUrl,
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
  ): UsageWarningService {
    const { notifications, organizations, projects } = setup.dependencies;
    return UsageWarningService.create({
      records: notifications,
      organizations: UsageLimitOrganizationService.create({ organizations, projects }),
      emails: notices,
      baseHost: setup.members.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL,
    });
  }

  /** Main's resource-limit Slack alert, over the same notices and admin read as the warning. */
  static #composeResourceLimitAlerts(
    setup: BillingSetup,
    notices: BillingUsageNoticeService,
  ): ResourceLimitAlertService {
    const { organizations, projects } = setup.dependencies;
    const { isSaas } = setup.members;
    return ResourceLimitAlertService.create({
      isSaas,
      cooldown: resourceLimitCooldown,
      organizations: UsageLimitOrganizationService.create({ organizations, projects }),
      plans: SaaSPlanProviderService.create({
        subscriptions: setup.repositories.subscriptions,
        isSaas,
      }),
      notices,
      errors: BillingErrorReporterService.create(),
    });
  }

  /** The construction once the payment provider's key has resolved, or not. */
  static assemble({
    members,
    repositories,
    config,
    peers,
    stripeSecretKey,
    statementMail,
    usageWarnings,
    resourceLimitAlerts,
    webhook,
    subscription,
    lifecycle,
  }: {
    members: BillingMembers;
    repositories: Pick<
      BillingRepositories,
      | "connectedBilling"
      | "checkpoints"
      | "reportOrganizations"
      | "billableEvents"
      | "organizationCache"
      | "subscriptions"
      | "organizationPricing"
      | "webhookSubscriptions"
      | "webhookOrganizations"
      | "seatEventSubscriptions"
      | "organizations"
      | "billableEventsMeter"
      | "tenantOrganizations"
      | "tenantOrganizationCache"
    >;
    config: Pick<BillingServerConfig, "bankDetails" | "licensePaymentLinkId">;
    peers: ConnectedBillingPeers;
    stripeSecretKey: string | undefined;
    /** The monthly statement mail; absent, statements wait and nothing is recorded. */
    statementMail?: ConnectedStatementMailChannel;
    usageWarnings: UsageWarningService;
    resourceLimitAlerts: ResourceLimitAlertService;
    /** The Stripe callback's signing secret and outside reach; absent, the callback answers 404. */
    webhook?: StripeWebhookComposition;
    /** Main's subscription door; absent, every `subscription.*` procedure answers not found. */
    subscription?: SubscriptionComposition;
    /** Records the checkout and subscription changes for peers; absent where a suite composes none. */
    lifecycle?: BillingLifecycleAnnouncerService;
  }): BillingModule {
    const { isSaas, nodeEnvironment } = members;
    const repository = repositories.connectedBilling;
    const facts = ConnectedCustomerFactsService.create(peers);
    const overview = ConnectedBillingOverviewService.create({
      repository,
      facts,
      licensing: peers.licensing,
    });
    const gate = {
      authorization: peers.authorization,
      auditLog: peers.auditLog,
      overview,
      subscriptionPlans: SaaSPlanProviderService.create({
        subscriptions: repositories.subscriptions,
        isSaas,
      }),
      isSaas,
      usageWarnings,
      resourceLimitAlerts,
      billableEvents: BillableEventsQueryService.create(repositories.billableEvents),
      pricing: OrganizationPricingService.create(repositories.organizationPricing),
      reporting: BillingModule.#composeReporting({
        repositories,
        peers,
        facts,
        isSaas,
        usageReporting: isSaas
          ? () =>
              StripeUsageReportingBuilder.create({
                secretKey: stripeSecretKey,
                nodeEnvironment,
              }).build()
          : void 0,
      }),
    };
    if (!stripeSecretKey) {
      return new BillingModule({
        ...gate,
        lifecycle,
        connected: void 0,
        stripeWebhook: BillingModule.#undispatchedWebhook(),
        subscriptions: void 0,
      });
    }

    const invoicing = connectedInvoicingChannels.http.create({
      secretKey: stripeSecretKey,
      usagePriceId: () =>
        BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(nodeEnvironment)).prices
          .CONNECTED_HOSTED_USAGE_QUARTERLY,
    });
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
            stripeSecretKey,
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
              stripeSecretKey,
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
    stripeSecretKey,
    nodeEnvironment,
    repositories,
  }: {
    subscription: SubscriptionComposition;
    stripeSecretKey: string;
    nodeEnvironment: string | undefined;
    repositories: Pick<
      BillingRepositories,
      "subscriptions" | "organizations" | "seatEventSubscriptions"
    >;
  }): SubscriptionDoor {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
    const prices = BillingPriceCatalogue.create(
      getStripeEnvironmentFromNodeEnv(nodeEnvironment),
    ).prices;
    const stripeErrors = StripeErrorTranslatorService.create();
    return {
      customers: CustomerService.create({ stripe, organizations: subscription.organizations }),
      subscriptions: BillingSubscriptionService.create({
        repository: repositories.subscriptions,
        organizationRepository: repositories.organizations,
        stripe,
        itemCalculator: SubscriptionItemCalculatorService.create(prices),
        seatEventService: SeatEventSubscriptionService.create({
          stripe,
          subscriptions: repositories.seatEventSubscriptions,
          invites: subscription.organizations,
          prices,
          customerCurrency: StripeCustomerCurrencyService.create(stripeErrors),
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

  async createSubscriptionWithInvites(input: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: SubscriptionBillingInterval;
    invites: readonly SubscriptionInvite[];
    invitedBy: OrganizationCaller;
  }): Promise<{ url: string | null }> {
    return this.#subscriptionDoor.subscriptions.createSubscriptionWithInvites(input);
  }

  async listInvoices(input: { organizationId: string }): Promise<BillingDisplayInvoice[]> {
    return this.#subscriptionDoor.subscriptions.listInvoices(input);
  }

  /** Main's `EEWebhookService` behind the callback, over billing's own rows. */
  static #composeStripeWebhook({
    webhook,
    isSaas,
    stripeSecretKey,
    nodeEnvironment,
    repositories,
    licensePaymentLinkId,
    connectedBilling,
    announcer,
  }: {
    announcer: BillingLifecycleAnnouncerService | undefined;
    webhook: StripeWebhookComposition;
    isSaas: boolean;
    stripeSecretKey: string;
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
      stripe: new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION }),
      itemCalculator: SubscriptionItemCalculatorService.create(prices),
      licensePaymentLinkId,
      inviteApprover: webhook.invites,
      licensePurchaseHandler: webhook.licensePurchase,
      host: webhook.host,
      retention: webhook.retention,
      connectedBilling,
      ...(announcer ? { announcer } : {}),
    });
    return StripeWebhookReceiptService.create({
      dispatchesEvents: () => isSaas,
      hasSigningSecret: () => webhook.signing.isConfigured(),
      constructEvent: (input) => webhook.signing.constructEvent(input),
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
  readonly #auditLog: Pick<AuditLogApi, "record">;
  readonly #overview: ConnectedBillingOverviewService;
  readonly #subscriptionPlans: SaaSPlanProviderService;
  readonly #isSaas: boolean;
  readonly #billableEvents: BillableEventsQueryService;
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
    auditLog,
    overview,
    subscriptionPlans,
    isSaas,
    billableEvents,
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
    auditLog: Pick<AuditLogApi, "record">;
    overview: ConnectedBillingOverviewService;
    subscriptionPlans: SaaSPlanProviderService;
    isSaas: boolean;
    billableEvents: BillableEventsQueryService;
    pricing: OrganizationPricingService;
    reporting: BillingReportingPipeline;
    usageWarnings: UsageWarningService;
    resourceLimitAlerts: ResourceLimitAlertService;
  }) {
    this.#stripeWebhook = stripeWebhook;
    this.#subscriptions = subscriptions;
    this.#connected = connected;
    this.#authorization = authorization;
    this.#auditLog = auditLog;
    this.#overview = overview;
    this.#subscriptionPlans = subscriptionPlans;
    this.#isSaas = isSaas;
    this.#billableEvents = billableEvents;
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

  countBillableEventsByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<{ projectId: string; count: number }[] | typeof USAGE_UNKNOWN> {
    return this.#billableEvents.countBillableEventsByProjects(input);
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
    isSaas,
    usageReporting,
  }: {
    repositories: Pick<
      BillingRepositories,
      | "checkpoints"
      | "reportOrganizations"
      | "billableEvents"
      | "organizationCache"
      | "billableEventsMeter"
      | "tenantOrganizations"
      | "tenantOrganizationCache"
    >;
    peers: Pick<ConnectedBillingPeers, "licensing" | "gateway">;
    facts: ConnectedCustomerFactsService;
    /** Main registered the billable-events meter on SaaS only. */
    isSaas: boolean;
    usageReporting: (() => UsageReportingService) | undefined;
  }): BillingReportingPipeline {
    const billableEvents = BillableEventsQueryService.create(repositories.billableEvents);
    const projects = {
      findProjectIds: (organizationId: string) => facts.findProjectIds(organizationId),
    };
    const instantEvalSpend = InstantEvalSpendQueryService.create({
      isSpendSourceAvailable: () => peers.gateway.isSpendSourceAvailable(),
      listProjectIds: ({ organizationId }) => projects.findProjectIds(organizationId),
      sumSpendNanoUsdByRequestType: (input) => peers.gateway.sumSpendNanoUsdByRequestType(input),
    });
    const ceiling = ConnectedUsageCeilingService.create({
      licensing: peers.licensing,
      gateway: peers.gateway,
      projects,
    });
    let reporter: UsageReportingService | undefined;

    return BillingReportingPipeline.create({
      organizations: repositories.reportOrganizations,
      billingCheckpoints: repositories.checkpoints,
      getUsageReportingService: () => (reporter ??= usageReporting?.()),
      queryBillableEventsTotal: (input) => billableEvents.queryBillableEventsTotal(input),
      queryInstantEvalSpendTotal: (input) => instantEvalSpend.queryInstantEvalSpendTotal(input),
      organizationCache: repositories.organizationCache,
      errorReporter: BillingErrorReporterService.create(),
      connectedUsageCeiling: async (input) => {
        const answer = await ceiling.getRemaining(input);
        return answer.kind === "capped" ? answer.remainingUnits : null;
      },
      meter: isSaas
        ? {
            meter: repositories.billableEventsMeter,
            organizations: BillingTenantOrganizationService.create({
              organizations: repositories.tenantOrganizations,
              cache: repositories.tenantOrganizationCache,
            }),
          }
        : void 0,
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
        (await this.#isOperator({ userId: impersonatorId, permission: "ops:view" })),
    };
  }

  async getConnectedBillingOverview(
    input: { organizationId: string },
    by: BillingStaff | null,
  ): Promise<ConnectedBillingOverview> {
    const staff = await this.#admitStaff({ by, permission: "ops:view" });
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
    by: BillingStaff | null,
  ): Promise<ConnectedBillingAccountView> {
    const staff = await this.#admitStaff({ by, permission: "ops:manage" });
    const account = await this.#connectedBilling().billing.onboard({
      ...input,
      termStartsAt: Temporal.Instant.from(input.termStartsAt),
      termEndsAt: Temporal.Instant.from(input.termEndsAt),
      operatorId: staff.id,
    });
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
    by: BillingStaff | null,
  ): Promise<ConnectedCreditGrantView> {
    const staff = await this.#admitStaff({ by, permission: "ops:manage" });
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
    by: BillingStaff | null,
  ): Promise<ConnectedBillingAccountView> {
    const staff = await this.#admitStaff({ by, permission: "ops:manage" });
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
    by: BillingStaff | null,
  ): Promise<RenewalCompletion> {
    const staff = await this.#admitStaff({ by, permission: "ops:manage" });
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
    by: BillingStaff | null,
  ): Promise<void> {
    const staff = await this.#admitStaff({ by, permission: "ops:manage" });
    await this.#connectedBilling().billing.markPaidOutOfBand(input);
    await this.#auditLog.record({
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
    args: RecordAuditLogCommand["args"];
    organizationId: string;
  }): Promise<void> {
    await this.#auditLog.record({
      userId: staff.id,
      action,
      args,
      targetKind: "organization",
      targetId: organizationId,
    });
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

  /** The staff member, or a 404 that says nothing about why. */
  async #admitStaff({
    by,
    permission,
  }: {
    by: BillingStaff | null;
    permission: OpsOperatorPermission;
  }): Promise<BillingStaff> {
    if (!by || !(await this.#isOperator({ userId: by.id, permission }))) {
      throw new AdminSurfaceHiddenError();
    }
    return by;
  }

  #isOperator({
    userId,
    permission,
  }: {
    userId: string;
    permission: OpsOperatorPermission;
  }): Promise<boolean> {
    return this.#authorization.can({
      principal: { type: "user", id: userId },
      permission,
      scope: { type: "platform" },
    });
  }

  /** Off Cloud nothing is invoiced; on Cloud a missing payment key is a deployment fault. */
  #connectedBilling(): ConnectedBilling {
    if (this.#connected) return this.#connected;
    if (!this.#isSaas) throw new ConnectedBillingUnavailableError();

    throw new Error("Connected billing needs the payment provider's secret key.");
  }
}
