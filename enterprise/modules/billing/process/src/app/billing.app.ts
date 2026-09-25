// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  BillingApi,
  billingConfig,
  BillingPriceCatalogue,
  billingSecrets,
  type BillingServerConfig,
  type BillingStaff,
  type ConnectedAddCommitRequest,
  type ConnectedBillingAccountView,
  type ConnectedBillingOverview,
  ConnectedBillingUnavailableError,
  type ConnectedCreditGrantView,
  type ConnectedOnboardRequest,
  type ConnectedRenewRequest,
  getStripeEnvironmentFromNodeEnv,
  type RenewalCompletion,
  type ReportUsageForMonthCommandData,
  type ScenarioCreatedSignal,
  type SeatChangeBillingOutcome,
  type SubscriptionPlanInput,
  type BillingPricingModel,
  type USAGE_UNKNOWN,
} from "@langwatch/enterprise-billing-contract";
import { LicensingApi, type PlanInfo } from "@langwatch/enterprise-licensing-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { GatewayApi } from "@langwatch/gateway-contract";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import type { EmailDelivery } from "@langwatch/mail";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";

import { connectedInvoicingChannels } from "../channels/connected-invoicing-channels.registry.ts";
import type { ConnectedStatementMailChannel } from "../channels/connected-statement-mail.channel.ts";
import { usageLimitEmailChannels } from "../channels/usage-limit-email-channels.registry.ts";
import {
  type BillingReportingDefinition,
  BillingReportingPipeline,
} from "../eventing/billing-reporting.pipeline.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import { fireScenarioCreated } from "../rules/nurturing-feature-adoption-service.rules.ts";
import { BillableEventsQueryService } from "../services/billable-events-query.service.ts";
import { BillingErrorReporterService } from "../services/billing-error-reporter.service.ts";
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
import { InstantEvalSpendQueryService } from "../services/instant-eval-spend-query.service.ts";
import { MeteredUsageWarningService } from "../services/metered-usage-warning.service.ts";
import { OrganizationPricingService } from "../services/organization-pricing.service.ts";
import { SaaSPlanProviderService } from "../services/plan-provider.service.ts";
import {
  ScenarioCreatedSignalService,
  type ScenarioSignalOrganizations,
} from "../services/scenario-created-signal.service.ts";
import { UsageLimitOrganizationService } from "../services/usage-limit-organization.service.ts";
import {
  StripeUsageReportingBuilder,
  type UsageReportingService,
} from "../services/usage-reporting.service.ts";

/** Both are the process's own facts: where it runs, and which price mode it bills in. */
type BillingMembers = Readonly<{ isSaas: boolean; nodeEnvironment: string | undefined }>;

/** Main's `env.BASE_HOST ?? "https://app.langwatch.ai"` for the usage link. */
const DEFAULT_PUBLIC_BASE_URL = "https://app.langwatch.ai";

type BillingSetup = FeatureSetup<
  typeof BillingApp.dependencies,
  BillingMembers & Readonly<{ mail: EmailDelivery; publicBaseUrl: string | undefined }>,
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
>;

/** The peers connected billing reads and gates through, each only as wide as it is used. */
export type ConnectedBillingPeers = Readonly<{
  licensing: ConnectedLicensing;
  operators: Pick<OpsApi, "isAdmin">;
  auditLog: Pick<AuditLogApi, "record">;
  organizations: ConnectedCustomerPeers["organizations"] & ScenarioSignalOrganizations;
  gateway: ConnectedCustomerPeers["gateway"];
}>;

type ConnectedBilling = Readonly<{
  billing: ConnectedBillingService;
  seats: ConnectedSeatChangeService;
  tick: ConnectedBillingTickService;
}>;

export class BillingApp implements BillingApi {
  static readonly contract = BillingApi;
  static readonly dependencies = {
    /** The commit and the contract budget live on the license, not here. */
    licensing: LicensingApi,
    /** The staff list the backoffice commands are checked against. */
    operators: OpsApi,
    /** Which organizations are connected customers, and their projects. */
    organizations: OrganizationApi,
    /** The spend ledger a statement sums. */
    gateway: GatewayApi,
    /** Where every backoffice billing command is recorded, as main recorded it. */
    auditLog: AuditLogApi,
    /** Where the usage-limit warning is written down, and read back so it goes once a month. */
    notifications: NotificationApi,
    /** The per-project trace counts a usage-limit warning lists. */
    traces: TraceApi,
    /** The named projects a usage-limit warning lists. */
    projects: ProjectApi,
  };
  static readonly config = billingConfig;
  static readonly secrets = { stripeSecretKey: billingSecrets.stripeSecretKey } as const;
  static readonly reads = ["isSaas", "nodeEnvironment", "mail", "publicBaseUrl"] as const;

  static create(setup: BillingSetup): Promise<BillingApp> {
    return setup.secrets.into(BillingApp.secrets.stripeSecretKey, (stripeSecretKey) =>
      BillingApp.assemble({
        members: setup.members,
        repositories: setup.repositories,
        config: setup.config,
        peers: setup.dependencies,
        stripeSecretKey,
        usageWarnings: BillingApp.#composeUsageWarnings(setup),
      }),
    );
  }

  /** Main's usage-limit warning, sent over the process's mail member. */
  static #composeUsageWarnings(setup: BillingSetup): MeteredUsageWarningService {
    const { notifications, traces, organizations, projects } = setup.dependencies;
    const billableEvents = BillableEventsQueryService.create(setup.repositories.billableEvents);
    return MeteredUsageWarningService.create({
      records: notifications,
      organizations: UsageLimitOrganizationService.create({ organizations, projects }),
      emails: BillingUsageNoticeService.create({
        config: {},
        usageLimitEmail: usageLimitEmailChannels.ses.create(setup.members.mail),
      }),
      baseHost: setup.members.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL,
      counters: {
        traces: { getCountByProjects: (input) => traces.countTracesByProjects(input) },
        events: {
          getCountByProjects: (input) => billableEvents.countBillableEventsByProjects(input),
        },
      },
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
    >;
    config: Pick<BillingServerConfig, "bankDetails">;
    peers: ConnectedBillingPeers;
    stripeSecretKey: string | undefined;
    /** No process composes the statement mail yet; absent, statements wait. */
    statementMail?: ConnectedStatementMailChannel;
    usageWarnings: MeteredUsageWarningService;
  }): BillingApp {
    const { isSaas, nodeEnvironment } = members;
    const repository = repositories.connectedBilling;
    const facts = ConnectedCustomerFactsService.create(peers);
    const overview = ConnectedBillingOverviewService.create({
      repository,
      facts,
      licensing: peers.licensing,
    });
    const scenarioSignals = ScenarioCreatedSignalService.create({
      organizations: peers.organizations,
      // No process composes billing's product-analytics sink yet; nurturing
      // reaches Customer.io through the sink the process registers, if any.
      posthog: void 0,
      nurture: fireScenarioCreated,
    });
    const gate = {
      operators: peers.operators,
      auditLog: peers.auditLog,
      overview,
      scenarioSignals,
      subscriptionPlans: SaaSPlanProviderService.create({
        subscriptions: repositories.subscriptions,
        isSaas,
      }),
      isSaas,
      usageWarnings,
      billableEvents: BillableEventsQueryService.create(repositories.billableEvents),
      pricing: OrganizationPricingService.create(repositories.organizationPricing),
      reporting: BillingApp.#composeReporting({
        repositories,
        peers,
        facts,
        usageReporting: isSaas
          ? () =>
              StripeUsageReportingBuilder.create({
                secretKey: stripeSecretKey,
                nodeEnvironment,
              }).build()
          : void 0,
      }),
    };
    if (!stripeSecretKey) return new BillingApp({ ...gate, connected: void 0 });

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
    const seats = ConnectedSeatChangeService.create({ repository, invoicing });

    return new BillingApp({
      ...gate,
      connected: {
        billing,
        seats,
        tick: ConnectedBillingTickService.create({
          seats,
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

  readonly #connected: ConnectedBilling | undefined;
  readonly #operators: Pick<OpsApi, "isAdmin">;
  readonly #auditLog: Pick<AuditLogApi, "record">;
  readonly #overview: ConnectedBillingOverviewService;
  readonly #scenarioSignals: ScenarioCreatedSignalService;
  readonly #subscriptionPlans: SaaSPlanProviderService;
  readonly #isSaas: boolean;
  readonly #billableEvents: BillableEventsQueryService;
  readonly #pricing: OrganizationPricingService;
  readonly #reporting: BillingReportingPipeline;
  readonly #usageWarnings: MeteredUsageWarningService;

  private constructor({
    connected,
    operators,
    auditLog,
    overview,
    scenarioSignals,
    subscriptionPlans,
    isSaas,
    billableEvents,
    pricing,
    reporting,
    usageWarnings,
  }: {
    connected: ConnectedBilling | undefined;
    operators: Pick<OpsApi, "isAdmin">;
    auditLog: Pick<AuditLogApi, "record">;
    overview: ConnectedBillingOverviewService;
    scenarioSignals: ScenarioCreatedSignalService;
    subscriptionPlans: SaaSPlanProviderService;
    isSaas: boolean;
    billableEvents: BillableEventsQueryService;
    pricing: OrganizationPricingService;
    reporting: BillingReportingPipeline;
    usageWarnings: MeteredUsageWarningService;
  }) {
    this.#connected = connected;
    this.#operators = operators;
    this.#auditLog = auditLog;
    this.#overview = overview;
    this.#scenarioSignals = scenarioSignals;
    this.#subscriptionPlans = subscriptionPlans;
    this.#isSaas = isSaas;
    this.#billableEvents = billableEvents;
    this.#pricing = pricing;
    this.#reporting = reporting;
    this.#usageWarnings = usageWarnings;
  }

  checkAndSendUsageWarning(input: {
    organizationId: string;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    meter: "traces" | "events";
  }): Promise<{ sent: boolean; notificationId?: string; sentAt?: Instant }> {
    return this.#usageWarnings.checkAndSendWarning(input);
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
  }: {
    repositories: Pick<
      BillingRepositories,
      "checkpoints" | "reportOrganizations" | "billableEvents" | "organizationCache"
    >;
    peers: Pick<ConnectedBillingPeers, "licensing" | "gateway">;
    facts: ConnectedCustomerFactsService;
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
    });
  }

  recordScenarioCreated(input: ScenarioCreatedSignal): Promise<void> {
    return this.#scenarioSignals.record(input);
  }

  /** Main's composite recomputed `overrideAddingLimitations` from the impersonator. */
  async getActiveSubscriptionPlan({
    organizationId,
    user,
  }: SubscriptionPlanInput): Promise<PlanInfo> {
    const plan = await this.#subscriptionPlans.getActivePlan(organizationId, user);

    return {
      ...plan,
      overrideAddingLimitations: !!user?.impersonator && this.#operators.isAdmin(user.impersonator),
    };
  }

  async getConnectedBillingOverview(
    input: { organizationId: string },
    by: BillingStaff | null,
  ): Promise<ConnectedBillingOverview> {
    const staff = this.#admitStaff(by);
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
    const staff = this.#admitStaff(by);
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
    const staff = this.#admitStaff(by);
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
    const staff = this.#admitStaff(by);
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
    const staff = this.#admitStaff(by);
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
    const staff = this.#admitStaff(by);
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

  invoiceAddedSeats(input: {
    organizationId: string;
    licenseRowId: string;
    previousSeats: number;
    seats: number;
  }): Promise<SeatChangeBillingOutcome> {
    return this.#connectedBilling().seats.invoiceAddedSeats(input);
  }

  /** Every row it reads and every invoice it raises is Cloud's: an install runs nothing. */
  async runConnectedBillingTick(): Promise<void> {
    if (!this.#isSaas) return;
    await this.#connectedBilling().tick.run();
  }

  /** The staff member, or a 404 that says nothing about why. */
  #admitStaff(by: BillingStaff | null): BillingStaff {
    if (!by || !this.#operators.isAdmin({ email: by.email })) throw new AdminSurfaceHiddenError();
    return by;
  }

  /** Off Cloud nothing is invoiced; on Cloud a missing payment key is a deployment fault. */
  #connectedBilling(): ConnectedBilling {
    if (this.#connected) return this.#connected;
    if (!this.#isSaas) throw new ConnectedBillingUnavailableError();

    throw new Error("Connected billing needs the payment provider's secret key.");
  }
}
