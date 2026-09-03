/**
 * What an organization is allowed, and what it has used.
 *
 * Three things this process composes for itself, all read off its own graph:
 *
 *   - the PLAN PROVIDER every surface resolves an allowance through,
 *   - the USAGE READING the subscription screen's panel renders, and
 *   - the ENFORCEMENT the ingest doors refuse an over-plan export with.
 *
 * They are one module because all three are taken AGAINST the plan: the
 * allowance, the unit it is measured in and whether the organization is on a
 * free tier all come from the plan, and a second plan provider composed for
 * any of them would let the panel, the banner and the refusal disagree about
 * which plan an organization is on.
 *
 * ## What this deployment cannot resolve, and why it says so
 *
 *   - **No licence source, on a process that opened no database.** The licence
 *     leg is composed now, off the organization row it was activated on, which
 *     is how a licensed self-hosted deployment gets the Enterprise tier it
 *     bought. What is left is the DEGENERATE case: no database, no licence row,
 *     and the absence reported rather than a licensed install reading as one.
 *   - **No subscription source.** On the hosted deployment a paid plan comes
 *     from a Stripe subscription row, which is the Enterprise billing store.
 *     Absent, every organization resolves to the free baseline — reported at
 *     composition rather than discovered by a customer whose paid plan reads
 *     as free.
 *   - **No approaching-limit mail, on a deployment that named no `BASE_HOST`.**
 *     Not a gap in this process any more, and the reason recorded here was
 *     wrong twice over. The Notification vertical exists, so do
 *     `UsageLimitService` and `UsageWarningService` — and the two things that
 *     did not are now here: {@link ApiUsageLimitEmailAdapter} is a real
 *     `UsageLimitEmailAdapter` over `@langwatch/mail`, and this process reads a
 *     mailer configuration (`resolveApiMailConfig`). What is left is the
 *     DEGENERATE case: no `BASE_HOST` means no gateway and no host to build the
 *     usage link from, and `limits.checkAndSendUsageLimitNotification` refuses
 *     BY NAME rather than reporting that it sent something it did not.
 *
 * ## What it does resolve, and what that took
 *
 * An organization metered in EVENTS is counted here rather than reported
 * unknown. The rollup is keyed by ORGANIZATION — an organization's billable
 * events span every project it owns, so there is no project to route on — and
 * a tenant-keyed resolver cannot answer that id: the directory behind it looks
 * a project row up, so an organization id raises `UnknownTenantError` rather
 * than reading one tenant's rows on another's endpoint. What closed it was the
 * second accessor `ApiClickHouseInfrastructure` now publishes beside the
 * tenant-keyed one, over the SAME connection and the same physical endpoints:
 * `resolveOrganizationClient`. The two arrive here as ONE option, because they
 * are one object and a caller holding half of them is a state no root can
 * produce.
 *
 * The approaching-limit MAIL resolves too, and what that took is one composed
 * gateway plus three collaborators the warning service needs and no package
 * ships: the organization's administrators, the per-project breakdown the
 * message is mostly made of, and the notification row that stops a second
 * message going out the same month. All three are read off this process's own
 * graph, which is why they are here rather than in a feature package — which
 * store a deployment counts and mails from is a composition decision.
 */
import {
  BillableEventsQueryService,
  ClickHouseBillingAdapter,
  deploymentPlanSources,
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
  LicensingEntitlementSource,
  NodeLicenseCryptographyAdapter,
  type OrganizationLicensePort,
} from "@langwatch/enterprise-licensing-server";
import type { PlanProvider, UsageUnit } from "@langwatch/entitlement-contract";
import {
  EntitlementService,
  PrismaUsageMembershipRepository,
  resolveUsageMeter,
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
import { ApiUsageStatsPort } from "./api-trpc-collaborators.trace-group.composition";

/** What the plan provider is composed from. */
export type ApiPlanProviderOptions = Readonly<{
  /**
   * Whether this is the hosted deployment.
   *
   * It picks the BASELINE, and the two baselines are opposites: hosted starts
   * every organization on the free plan's limits and lifts them with a paid
   * source, self-hosted starts unlimited and a licence only narrows what is
   * switched on. Getting it wrong either way is a wrong answer in production,
   * so it is configuration rather than a guess.
   */
  isSaas: boolean;
  /**
   * Where an organization's activated licence key is read from.
   *
   * Absent exactly when this process opened no Postgres connection, and the
   * absence is reported: on a self-hosted deployment the licence is the ONLY
   * paid source there is, so a process that cannot read it resolves the
   * unlimited baseline for a customer whose contract names an Enterprise tier
   * — every allowance intact, and the tier's own entitlements withheld.
   */
  licenses?: OrganizationLicensePort;
  /**
   * The public key a licence signature is checked against, where the operator
   * rotated it.
   *
   * Absent means the key embedded in the licensing contract, which is what
   * verifies every licence LangWatch issues. A deployment that rotated the key
   * and did not name it here would refuse its own valid licence and fall
   * silently back to the baseline.
   */
  licensePublicKey?: string;
  /**
   * The Stripe subscription rows a hosted paid plan is read from.
   *
   * Optional because a self-hosted deployment has none to read, and because a
   * host may compose the provider itself. Supplied, it becomes the SUBSCRIPTION
   * source `EntitlementService` consults before the baseline; absent on a
   * hosted deployment, every organization resolves free and the absence is
   * reported.
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
 * Composes the plan provider this process resolves every allowance through.
 *
 * **The policy itself is not written here.** Which baseline this deployment
 * starts from, which paid source is consulted over it and what that source is
 * built from come from `deploymentPlanSources`
 * (`@langwatch/enterprise-billing-server`), which the background process reads
 * too. It used to be written out in both roots and held together only by two
 * suites asserting the same fixtures. What is this process's own is the rest of
 * this function: the absences it names, and the entitlement service it
 * constructs around the answer — the service belongs to the core Entitlements
 * feature, which a feature package may not import.
 *
 * The tier enricher travels with the licence leg and is threaded by the shared
 * policy, not here. It fills a tier entitlement only where the resolved plan
 * left it undefined, and a signed licence is the one leg that can: a contract
 * minted before a flag existed resolves `ENTERPRISE` with that field unset. A
 * tier entitlement the plan table does not carry fails
 * `deployment-plan-sources.unit.test.ts` rather than reaching a customer.
 */
export function composeApiPlanProvider(options: ApiPlanProviderOptions): PlanProvider {
  // Built here rather than inside the shared policy: verification lives in the
  // Licensing feature, and a feature package may not import another feature's
  // implementation — the same boundary that keeps `EntitlementService.create`
  // at this root. `forDeployment` is one call, so the mode it derives from
  // `isSaas` is decided once for both processes rather than twice.
  const license = options.licenses
    ? LicensingEntitlementSource.forDeployment({
        licenses: options.licenses,
        cryptography: NodeLicenseCryptographyAdapter.create(
          options.licensePublicKey ? { publicKey: options.licensePublicKey } : {},
        ),
        isSaas: options.isSaas,
      })
    : undefined;
  if (!license) options.report?.absent("licence");

  const sources = deploymentPlanSources({
    isSaas: options.isSaas,
    ...(license ? { license } : {}),
    ...(options.subscriptions ? { subscriptions: options.subscriptions } : {}),
    ...(options.adminEmails ? { adminEmails: options.adminEmails } : {}),
  });
  if (options.isSaas && !sources.subscription) options.report?.absent("subscription");

  return EntitlementService.create(sources);
}

/**
 * The two routings the usage rollups take, off the one connection.
 *
 * They differ in the ID, not the endpoint: `trace_summaries` is scoped by a set
 * of PROJECT ids and routes through the tenant directory, `billable_events` by
 * the ORGANIZATION that is billed for them, which the directory cannot answer
 * — it looks a project row up, so an organization id raises
 * `UnknownTenantError`. Both land on the same physical endpoint for the same
 * customer.
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
   *
   * None is the ONE case enforcement declines to run: a process that opened no
   * ClickHouse cannot count what an organization has used, and a meter whose
   * every reading is UNKNOWN is not enforcement — it is a warn line per
   * ingested batch and an allowance nobody is held to. Saying so once at boot
   * is the honest shape.
   */
  clickhouse: ApiUsageClickHouse | null;
  /** Picks the upgrade sentence the refusal ends with. */
  isSaas: boolean;
  /** The self-hosted install's own origin, for the licence link. */
  baseHost?: string | undefined;
}>;

/**
 * The plan's monthly allowance, measured against the month's real volume.
 *
 * Composed here rather than shipped by a package because all three of its
 * collaborators are this root's own: `UsageOrganizationPort` is a join across
 * the team, project and organization aggregates that no ONE feature package
 * may name at once — the same reason {@link ApiUsageWarningDirectory} is
 * here — and the two counters are the deployment's decision about which store
 * it meters from. The package owns the POLICY (`UsageService`), which is why
 * none of it is re-implemented below.
 *
 * The two counters are unit-specific on purpose. `UsageService` resolves the
 * meter itself and then asks the counter for that unit, so a single counter
 * that re-resolved the unit would decide it twice, and the two decisions would
 * be taken against two reads of the same plan.
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

  return new UsageService({
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
   * The ClickHouse this process opened, as the two routings the rollups take,
   * or none at all.
   *
   * ONE option rather than two, because they are one object: both accessors
   * are published by this process's single `ApiClickHouseInfrastructure` and
   * no deployment holds one without the other. As two fields they let a caller
   * compose HALF a ClickHouse — the trace rollup readable and the events
   * rollup not — which no root can produce, and which this reading has no
   * honest answer for: its seven readings are issued together, so a refusal in
   * one of them is a blank panel rather than one figure withheld.
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
 * The approaching-limit warning, or nothing to send it with.
 *
 * Nothing exactly when the deployment composed no mail. Every other
 * collaborator is available on a process that opened a database: the
 * administrators to write to, the per-project breakdown the message is mostly
 * made of, and the notification row that keeps a second message from going out
 * the same month.
 */
function composeApiUsageWarnings(
  options: ApiUsageStatsOptions,
  counter: ApiUsageCounterAdapter,
): UsageWarningService | undefined {
  const mail = options.mail;
  if (!mail) return undefined;

  return new UsageWarningService({
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
      checkAndSendWarning: (_ctx, input) =>
        warnings
          ? warnings.checkAndSendWarning({
              organizationId: input.organizationId,
              currentMonthMessagesCount: input.currentMonthMessagesCount,
              maxMonthlyUsageLimit: input.maxMonthlyUsageLimit,
            })
          : Promise.reject(new ApiUsageNotifierUnavailableError(this.processName)),
    };
  }
}

/**
 * The approaching-limit mail, rendered and sent by `@langwatch/mail`.
 *
 * A WHOLE send rather than a rendered body handed back: one recipient, one
 * subject, no BCC fan-out and no footer to sign, so there is no envelope
 * decision left for this process to make. Reaching the template here breaks no
 * boundary — `@langwatch/mail` is the one terminal
 * `frontend-boundary.unit.test.ts` allows a backend graph to enter, because
 * react-email renders server-side at send time.
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
 * Who the warning goes to, and which projects it breaks down.
 *
 * Three reads no package ships an implementation of, because each is a join
 * across two aggregates a feature package may not name at once. They are the
 * platform application's own queries, unchanged: administrators only —
 * a warning about an allowance is addressed to the people who can act on it —
 * and every project the organization owns, ordered by name so the table in the
 * message reads the same way twice.
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
 * One organization's volume, split by project, in whichever unit it is metered.
 *
 * The two units take different routes, and neither is the display counter's
 * single total. Events are one organization-keyed `GROUP BY TenantId` on the
 * billable-events rollup. Traces have no per-project read of their own — the
 * repository answers a total over a set of tenant ids — so this asks the same
 * question once per project, which is what tenant routing costs and what it
 * buys: each read lands on that project's own endpoint. An organization holds
 * a handful of projects and this runs on a user-initiated mutation, so the
 * fan-out is bounded and rare.
 *
 * UNKNOWN travels rather than a zero, all the way to the send: the message's
 * whole premise is that usage is high, and a table of zeros under that heading
 * tells an administrator the opposite of what happened. `UsageWarningService`
 * sends nothing on unknown and the threshold is still crossed on the next run.
 *
 * A process with NO ClickHouse answers unknown without asking, and that is the
 * one case the read below cannot recognise on its own: the events rollup is a
 * `GROUP BY`, so an unread rollup and an organization that sent nothing this
 * month both come back as an empty set. The difference is known here, at
 * composition, and nowhere below it.
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
 * The month's volume, and the unit it is counted in.
 *
 * The unit decision is the platform application's, unchanged: a licence's own
 * `usageUnit` wins, then a seat-and-event pricing model, then the free tier,
 * and otherwise traces. Both answers are read: `events` off the
 * organization-keyed `billable_events` rollup, `traces` off the tenant-keyed
 * `trace_summaries` one, and each returns UNKNOWN rather than zero when its
 * query did not run.
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
   * The same month's volume, split by project, in the same unit.
   *
   * Events come back in one organization-keyed read. Traces have no
   * per-project query — the repository answers a total over a set of tenant
   * ids — so each project is asked for separately, which is what tenant
   * routing costs: every read lands on that project's own endpoint. A single
   * null anywhere makes the whole breakdown UNKNOWN rather than a table with
   * one project silently reading zero.
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

    return resolveUsageMeter({
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
 *
 * Written here rather than in a feature package because each of the three
 * crosses an aggregate boundary a package may not: a team's organization, an
 * organization's projects, and the organization row's pricing model. They are
 * the platform application's own queries, unchanged.
 *
 * `tryGetOrganizationIdByTeamId` answers null rather than throwing on a team
 * nobody owns. `UsageService` turns that into `OrganizationNotFoundForTeamError`,
 * which the ingest door treats as a failed lookup and lets the batch through —
 * refusing a customer's telemetry because our own directory could not place
 * their team is the worse of the two errors.
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
 *
 * The rollup has no per-project read of its own — it answers a total over a
 * set of tenant ids — so each project is asked for separately, which is what
 * tenant routing costs and what it buys: every read lands on that project's
 * own endpoint. An organization holds a handful of projects.
 *
 * A single null anywhere makes the whole reading UNKNOWN rather than a total
 * with one project silently counted as zero: enforcement reads UNKNOWN as "we
 * cannot say" and lets traffic through, and it reads a short total as "well
 * inside the plan", which is the same permissive answer for the wrong reason
 * and stops being permissive the moment the real total crosses the cap.
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
 * The month's EVENT volume, in one organization-keyed read.
 *
 * The events rollup is a `GROUP BY TenantId` on rows already keyed by the
 * organization that is billed for them, so there is nothing to fan out and
 * `projectIds` is not consulted. An empty answer is a real measurement here —
 * this composition only builds the counter where a ClickHouse was opened, so
 * "no rows" means the organization sent nothing rather than "nobody asked".
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
