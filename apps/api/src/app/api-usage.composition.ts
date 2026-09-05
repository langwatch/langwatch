/**
 * What an organization is allowed, and what it has used.
 */
import {
  BillableEventsQueryService,
  ClickHouseBillingAdapter,
  DeploymentPlanSourcesService,
  NotificationService as BillingNotificationService,
  UsageLimitEmailAdapter,
  UsageWarningService,
  type BillingSubscriptionRepository,
  type UsageLimitEmailData,
} from "@langwatch/enterprise-billing-server";
import type {
  BillingUsageCounter,
  BillingUsageLimitOrganization,
} from "@langwatch/enterprise-billing-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  LicensingEntitlementSourceAdapter,
  NodeLicenseCryptographyAdapter,
  type OrganizationLicensePort,
} from "@langwatch/enterprise-licensing-server";
import type { PlanProvider, UsageUnit } from "@langwatch/entitlement-contract";
import {
  EntitlementService,
  PrismaUsageMembershipRepository,
  UsageMeterPolicyService,
  USAGE_UNKNOWN,
  UsageCounterPort,
  UsageOrganizationPort,
  UsageService,
  UsageStatsService,
  UsageVolumeCounterPort,
  type LimitsTrpcPorts,
  type ProjectUsageCounts,
  type UsageCount,
} from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import { sendUsageLimitEmail } from "@langwatch/mail";
import { PostgresNotificationAdapter } from "@langwatch/notification-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PricingModel, PrismaClient } from "@langwatch/prisma-client/generated";
import type { ApiMailComposition } from "./api-mail.composition";
import { ApiUsageStatsPort } from "../features/entitlement/spend.composition";

/** What the plan provider is composed from. */
export type ApiPlanProviderOptions = Readonly<{
  /**
   * Whether this is the hosted deployment.
   */
  isSaas: boolean;
  /**
   * Where an organization's activated licence key is read from.
   */
  licenses?: OrganizationLicensePort;
  /**
   * The public key a licence signature is checked against, where the operator rotated it.
   * Absent means the key embedded in the licensing contract, which is what verifies every
   * licence LangWatch issues.
   */
  licensePublicKey?: string;
  /**
   * The Stripe subscription rows a hosted paid plan is read from. Optional because a
   * self-hosted deployment has none to read, and because a host may compose the provider
   * itself.
   */
  subscriptions?: BillingSubscriptionRepository;
  /**
   * The operator allow-list, for the ONE thing the subscription source does
   * with it: an impersonating staff member sees the organization's real
   * limitations rather than the override.
   */
  adminEmails?: readonly string[];
  /** Where the absent sources are written down. */
  report?: ApiEntitlementAbsenceReport;
}>;

/** What each unresolvable plan source costs, written where a deployment reads it. */
export abstract class ApiEntitlementAbsenceReport {
  abstract absent(source: "licence" | "subscription" | "usage-mail"): void;
}

/** Writes each absent plan source to the process log, with what it costs. */
export class LoggedApiEntitlementAbsence extends ApiEntitlementAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiEntitlementAbsence {
    return new LoggedApiEntitlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(source: "licence" | "subscription" | "usage-mail"): void {
    this.logger.warn({ source }, ENTITLEMENT_CONSEQUENCE[source]);
  }
}

const ENTITLEMENT_CONSEQUENCE = {
  licence:
    "API process composed no licence source because it opened no database: an activated licence is not read here, so a licensed deployment resolves the same baseline an unlicensed one does and the Enterprise tier its contract names is withheld.",
  subscription:
    "API process composed no subscription source on a HOSTED deployment: every organization resolves the free baseline, including ones that are paying.",
  "usage-mail":
    "API process composed no mail gateway because this deployment named no BASE_HOST: there is no sender address to derive and no host to build the usage link from, so the approaching-limit mail refuses by name rather than reporting that it sent something.",
} as const;

/**
 * Composes the plan provider this process resolves every allowance through. **The policy
 * itself is not written here.** Which baseline this deployment starts from, which paid
 * source is consulted over it and what that source is built from come from
 */
export function composeApiPlanProvider(options: ApiPlanProviderOptions): PlanProvider {
  // Built here rather than inside the shared policy: verification lives in the
  // Licensing feature, and a feature package may not import another feature's
  // implementation — the same boundary that keeps `EntitlementService.create`
  // at this root. `forDeployment` is one call, so the mode it derives from
  // `isSaas` is decided once for both processes rather than twice.
  const license = options.licenses
    ? LicensingEntitlementSourceAdapter.forDeployment({
        licenses: options.licenses,
        cryptography: NodeLicenseCryptographyAdapter.create(
          options.licensePublicKey ? { publicKey: options.licensePublicKey } : {},
        ),
        isSaas: options.isSaas,
      })
    : undefined;
  if (!license) options.report?.absent("licence");

  const sources = DeploymentPlanSourcesService.create({
    isSaas: options.isSaas,
    ...(license ? { license } : {}),
    ...(options.subscriptions ? { subscriptions: options.subscriptions } : {}),
    ...(options.adminEmails ? { adminEmails: options.adminEmails } : {}),
  }).sources();
  if (options.isSaas && !sources.subscription) options.report?.absent("subscription");

  return EntitlementService.create(sources);
}

/**
 * The two routings the usage rollups take, off the one connection.
 */
export type ApiUsageClickHouse = Readonly<{
  /** Tenant-keyed, for the trace rollup. */
  resolveClient: (tenantId: string) => Promise<ClickHouseClient>;
  /** Organization-keyed, for the billable-events rollup. */
  resolveOrganizationClient: (organizationId: string) => Promise<ClickHouseClient>;
}>;

/** What the monthly allowance is enforced from. */
export type ApiUsageEnforcementOptions = Readonly<{
  /** The one guarded connection the organization graph is read on. */
  prisma: PrismaClient;
  /** The SAME plan provider the panel and every allowance banner read. */
  plans: PlanProvider;
  /**
   * The two routings the rollups take, or none at all.
   */
  clickhouse: ApiUsageClickHouse | null;
  /** Picks the upgrade sentence the refusal ends with. */
  isSaas: boolean;
  /** The self-hosted install's own origin, for the licence link. */
  baseHost?: string | undefined;
}>;

/**
 * The plan's monthly allowance, measured against the month's real volume.
 */
export function composeApiUsageEnforcement(
  options: ApiUsageEnforcementOptions,
): UsageService | undefined {
  if (!options.clickhouse) return undefined;

  // A query FACADE, not a connection: `ClickHouseBillingAdapter` holds the two
  // resolvers this process already published and opens nothing of its own, so
  // this is a second reader over one ClickHouse rather than a second
  // ClickHouse. The usage panel builds its own for the same reason.
  const billing = BillableEventsQueryService.create(
    ClickHouseBillingAdapter.create(options.clickhouse).build(),
  );

  return UsageService.create({
    organizations: ApiUsageOrganizationDirectory.create(options.prisma),
    traceCounter: ApiTraceVolumeCounter.create(billing),
    eventCounter: ApiEventVolumeCounter.create(billing),
    planResolver: (organizationId) => options.plans.getActivePlan({ organizationId }),
    deployment: {
      isSaas: options.isSaas,
      ...(options.baseHost ? { baseHost: options.baseHost } : {}),
    },
  });
}

/** What the usage reading is composed from. */
export type ApiUsageStatsOptions = Readonly<{
  /** The one guarded connection every membership and spend row is read on. */
  prisma: PrismaClient;
  /** The plan the reading is taken against — the SAME one every banner reads. */
  plans: PlanProvider;
  /**
   * The ClickHouse this process opened, as the two routings the rollups take, or none at
   * all.
   */
  clickhouse: ApiUsageClickHouse | null;
  /**
   * The gateway the approaching-limit mail leaves through, and the host it
   * links back to. Absent on a deployment that named no `BASE_HOST`, which is
   * the one case the warning still refuses in.
   */
  mail?: ApiMailComposition | undefined;
  /** Names a refusal, so the mail's absence says which process reached it. */
  processName: string;
  /** Where the one degraded answer left here is written down. */
  report?: ApiEntitlementAbsenceReport;
}>;

/** Composes the usage reading over this process's own rows and rollups. */
export function composeApiUsageStats(options: ApiUsageStatsOptions): ApiUsageStatsPort {
  if (!options.mail) options.report?.absent("usage-mail");

  // ONE counter, read by both halves. The panel's total and the warning's
  // breakdown are the same measurement at two granularities, and a second
  // adapter would open a second ClickHouse billing graph over the same
  // connection to answer them differently.
  const counter = ApiUsageCounterAdapter.create(options);
  const stats = UsageStatsService.create({
    membership: PrismaUsageMembershipRepository.create(options.prisma),
    counter,
    plans: options.plans,
  });

  return ApiComposedUsageStats.create({
    stats,
    warnings: composeApiUsageWarnings(options, counter),
    processName: options.processName,
  });
}

/**
 * The approaching-limit warning, or nothing to send it with. Nothing exactly when the
 * deployment composed no mail.
 */
function composeApiUsageWarnings(
  options: ApiUsageStatsOptions,
  counter: ApiUsageCounterAdapter,
): UsageWarningService | undefined {
  const mail = options.mail;
  if (!mail) return undefined;

  return UsageWarningService.create({
    records: PostgresNotificationAdapter.create({ database: options.prisma }).build(),
    organizations: ApiUsageWarningDirectory.create(options.prisma),
    usageCounts: ApiUsageBreakdownAdapter.create(counter, options.clickhouse !== null),
    emails: BillingNotificationService.create({
      config: { baseHost: mail.baseHost },
      usageLimitEmail: ApiUsageLimitEmailAdapter.create(mail),
    }),
    baseHost: mail.baseHost,
  });
}

class ApiComposedUsageStats extends ApiUsageStatsPort {
  static create(options: {
    stats: UsageStatsService;
    warnings: UsageWarningService | undefined;
    processName: string;
  }): ApiComposedUsageStats {
    return new ApiComposedUsageStats(options.stats, options.warnings, options.processName);
  }

  private constructor(
    private readonly stats: UsageStatsService,
    private readonly warnings: UsageWarningService | undefined,
    private readonly processName: string,
  ) {
    super();
  }

  ports(): LimitsTrpcPorts {
    const warnings = this.warnings;
    return {
      getUsageStats: (_ctx, input) => this.stats.getUsageStats(input.organizationId, input.user),
      tryCheckAndSendWarning: (_ctx, input) =>
        warnings
          ? warnings.tryCheckAndSendWarning({
              organizationId: input.organizationId,
              currentMonthMessagesCount: input.currentMonthMessagesCount,
              maxMonthlyUsageLimit: input.maxMonthlyUsageLimit,
            })
          : Promise.reject(new ApiUsageNotifierUnavailableError(this.processName)),
    };
  }
}

/**
 * The approaching-limit mail, rendered and sent by `@langwatch/mail`. A WHOLE send rather
 * than a rendered body handed back: one recipient, one subject, no BCC fan-out and no
 * footer to sign, so there is no envelope decision left for this process to make.
 */
export class ApiUsageLimitEmailAdapter extends UsageLimitEmailAdapter {
  static create(mail: ApiMailComposition): ApiUsageLimitEmailAdapter {
    return new ApiUsageLimitEmailAdapter(mail);
  }

  private constructor(private readonly mail: ApiMailComposition) {
    super();
  }

  async send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void> {
    // `usage` already carries the organization's name, and it is the same one:
    // `NotificationService` reads both off the record it was handed.
    await sendUsageLimitEmail({
      mailer: this.mail.delivery,
      to: input.to,
      ...input.usage,
    });
  }
}

/**
 * Who the warning goes to, and which projects it breaks down. Three reads no package
 * ships an implementation of, because each is a join across two aggregates a feature
 * package may not name at once.
 */
class ApiUsageWarningDirectory implements BillingUsageLimitOrganization {
  static create(prisma: PrismaClient): ApiUsageWarningDirectory {
    return new ApiUsageWarningDirectory(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async findWithAdmins(organizationId: string): Promise<{
    id: string;
    name: string;
    sentPlanLimitAlert: Date | null;
    members: Array<{ user: { id: string; name: string | null; email: string | null } }>;
  } | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        sentPlanLimitAlert: true,
        members: {
          where: { role: "ADMIN" },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    return organization ?? null;
  }

  async updateSentPlanLimitAlert(organizationId: string, timestamp: Date): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { sentPlanLimitAlert: timestamp },
    });
  }

  async findProjectsWithName(organizationId: string): Promise<Array<{ id: string; name: string }>> {
    return await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
}

/**
 * One organization's volume, split by project, in whichever unit it is metered. The two
 * units take different routes, and neither is the display counter's single total. Events
 * are one organization-keyed `GROUP BY TenantId` on the billable-events rollup.
 */
class ApiUsageBreakdownAdapter implements BillingUsageCounter {
  static create(counter: ApiUsageCounterAdapter, readable: boolean): ApiUsageBreakdownAdapter {
    return new ApiUsageBreakdownAdapter(counter, readable);
  }

  private constructor(
    private readonly counter: ApiUsageCounterAdapter,
    private readonly readable: boolean,
  ) {}

  async getCountByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<Array<{ projectId: string; count: number }> | typeof USAGE_UNKNOWN> {
    if (!this.readable) return USAGE_UNKNOWN;
    if (input.projectIds.length === 0) return [];
    return await this.counter.countByProjects(input);
  }
}

/**
 * The month's volume, and the unit it is counted in. The unit decision is the platform
 * application's, unchanged: a licence's own `usageUnit` wins, then a seat-and-event
 * pricing model, then the free tier, and otherwise traces.
 */
class ApiUsageCounterAdapter extends UsageCounterPort {
  static create(options: ApiUsageStatsOptions): ApiUsageCounterAdapter {
    return new ApiUsageCounterAdapter(
      options.prisma,
      options.plans,
      // The pair, handed straight through: the adapter's two resolvers ARE the
      // two accessors, so there is nothing left here to get the wrong way
      // round. Null is a deployment that opened no ClickHouse, and both
      // rollups then read UNKNOWN rather than zero.
      BillableEventsQueryService.create(
        options.clickhouse ? ClickHouseBillingAdapter.create(options.clickhouse).build() : null,
      ),
    );
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly plans: PlanProvider,
    private readonly billing: BillableEventsQueryService,
  ) {
    super();
  }

  async getCurrentMonthCountForDisplay(input: { organizationId: string }): Promise<UsageCount> {
    const unit = await this.getResolvedUsageUnit(input);
    if (unit === "events") {
      // Approximate on purpose, and the same HyperLogLog read the enforcement
      // path takes: ~1% error, constant memory, and what a person reads on the
      // usage panel. The exact count is the invoice's, not this panel's.
      const events = await this.billing.tryQueryBillableEventsTotalUniq({
        organizationId: input.organizationId,
        billingMonth: BillableEventsQueryService.getBillingMonth(),
      });
      // Null means the query did not run, which is not the same fact as zero.
      return events ?? USAGE_UNKNOWN;
    }

    const projectIds = await this.projectIdsOf(input.organizationId);
    // A real measurement: an organization with no projects has sent nothing.
    if (projectIds.length === 0) return 0;

    const total = await this.billing.tryQueryTraceSummariesTotalUniq({
      projectIds,
      billingMonth: BillableEventsQueryService.getBillingMonth(),
    });
    // Null means the query did not run, which is not the same fact as zero.
    return total ?? USAGE_UNKNOWN;
  }

  /**
   * The same month's volume, split by project, in the same unit. Events come back in one
   * organization-keyed read.
   */
  async countByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<Array<{ projectId: string; count: number }> | typeof USAGE_UNKNOWN> {
    const billingMonth = BillableEventsQueryService.getBillingMonth();
    const unit = await this.getResolvedUsageUnit(input);
    if (unit === "events") {
      return await this.billing.queryBillableEventsByProjectApprox({
        organizationId: input.organizationId,
        billingMonth,
      });
    }

    const counts = await Promise.all(
      input.projectIds.map(async (projectId) => ({
        projectId,
        count: await this.billing.tryQueryTraceSummariesTotalUniq({
          projectIds: [projectId],
          billingMonth,
        }),
      })),
    );
    if (counts.some((entry) => entry.count === null)) return USAGE_UNKNOWN;

    return counts.map((entry) => ({ projectId: entry.projectId, count: entry.count ?? 0 }));
  }

  async getResolvedUsageUnit(input: { organizationId: string }): Promise<UsageUnit> {
    const [organization, plan] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { pricingModel: true },
      }),
      this.plans.getActivePlan({ organizationId: input.organizationId }),
    ]);

    return UsageMeterPolicyService.resolveUsageMeter({
      pricingModel: (organization?.pricingModel ?? null) as PricingModel | null,
      ...(plan.usageUnit !== undefined ? { licenseUsageUnit: plan.usageUnit } : {}),
      hasValidLicenseOverride: plan.planSource === "license",
      isFree: plan.free,
    }).usageUnit;
  }

  private async projectIdsOf(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((project) => project.id);
  }
}

/**
 * The organization graph, as enforcement needs it: three reads, one client.
 */
class ApiUsageOrganizationDirectory extends UsageOrganizationPort {
  static create(prisma: PrismaClient): ApiUsageOrganizationDirectory {
    return new ApiUsageOrganizationDirectory(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async tryGetOrganizationIdByTeamId(input: { teamId: string }): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: input.teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((project) => project.id);
  }

  async tryGetPricingModel(organizationId: string): Promise<PricingModel | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return (organization?.pricingModel ?? null) as PricingModel | null;
  }
}

/**
 * The month's TRACE volume, one project at a time.
 */
class ApiTraceVolumeCounter extends UsageVolumeCounterPort {
  static create(billing: BillableEventsQueryService): ApiTraceVolumeCounter {
    return new ApiTraceVolumeCounter(billing);
  }

  private constructor(private readonly billing: BillableEventsQueryService) {
    super();
  }

  async getCountByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts> {
    const billingMonth = BillableEventsQueryService.getBillingMonth();
    const counts = await Promise.all(
      input.projectIds.map(async (projectId) => ({
        projectId,
        count: await this.billing.tryQueryTraceSummariesTotalUniq({
          projectIds: [projectId],
          billingMonth,
        }),
      })),
    );
    if (counts.some((entry) => entry.count === null)) return USAGE_UNKNOWN;

    return counts.map((entry) => ({ projectId: entry.projectId, count: entry.count ?? 0 }));
  }
}

/**
 * The month's EVENT volume, in one organization-keyed read. The events rollup is a `GROUP
 * BY TenantId` on rows already keyed by the organization that is billed for them, so
 * there is nothing to fan out and `projectIds` is not consulted.
 */
class ApiEventVolumeCounter extends UsageVolumeCounterPort {
  static create(billing: BillableEventsQueryService): ApiEventVolumeCounter {
    return new ApiEventVolumeCounter(billing);
  }

  private constructor(private readonly billing: BillableEventsQueryService) {
    super();
  }

  async getCountByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<ProjectUsageCounts> {
    return await this.billing.queryBillableEventsByProjectApprox({
      organizationId: input.organizationId,
      billingMonth: BillableEventsQueryService.getBillingMonth(),
    });
  }
}

/** The approaching-limit mail was asked for on a deployment with no gateway. */
class ApiUsageNotifierUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability: "the approaching-limit notification" },
    });
    this.name = "ApiUsageNotifierUnavailableError";
  }
}

/** The logger name the two absences above are written under. */
export const API_ENTITLEMENT_LOGGER = "langwatch:api:entitlement";

/** Convenience for the composition root: one report, named once. */
export function apiEntitlementAbsenceReport(serviceName: string): LoggedApiEntitlementAbsence {
  return LoggedApiEntitlementAbsence.create(createLogger(`${serviceName}:entitlement`));
}
