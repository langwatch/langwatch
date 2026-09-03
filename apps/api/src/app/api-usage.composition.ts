/**
 * What an organization is allowed, and what it has used.
 *
 * Two things this process composes for itself, both read off its own graph:
 *
 *   - the PLAN PROVIDER every surface resolves an allowance through, and
 *   - the USAGE READING the subscription screen's panel renders.
 *
 * They are one module because the reading is taken AGAINST the plan: the
 * allowance, the unit it is measured in and whether the organization is on a
 * free tier all come from the plan, and a second plan provider composed for
 * the reading would let the panel and the banner disagree about which plan an
 * organization is on.
 *
 * ## What this deployment cannot resolve, and why it says so
 *
 *   - **No licence source.** A signed licence is read by the Enterprise
 *     licensing service, which this process composes none of, so a licensed
 *     self-hosted install resolves the same unlimited BASELINE an unlicensed
 *     one does. The two agree on every allowance; they differ only in the tier
 *     entitlements a licence carries, and applying those is the licensing
 *     provider's own step, not something this process can stand in for.
 *   - **No subscription source.** On the hosted deployment a paid plan comes
 *     from a Stripe subscription row, which is the Enterprise billing store.
 *     Absent, every organization resolves to the free baseline — reported at
 *     composition rather than discovered by a customer whose paid plan reads
 *     as free.
 *   - **No approaching-limit mail.** The Notification vertical is NOT the gap —
 *     it exists, and so do `UsageLimitService` and `UsageWarningService`. Two
 *     things do not: the only implementation of `UsageLimitEmailAdapter` in the
 *     tree is `NullUsageLimitEmailAdapter`, which sends nothing, and this
 *     process parses no mailer configuration at all. So
 *     `limits.checkAndSendUsageLimitNotification` refuses BY NAME rather than
 *     reporting that it sent something it did not.
 *   - **Events metering.** The billable-events rollup is keyed by
 *     ORGANIZATION and routes on an organization-keyed ClickHouse client; this
 *     process publishes a tenant-keyed resolver only. Routing an organization
 *     id through it does not MIS-ROUTE — the directory answers a project id, so
 *     an organization id raises `UnknownTenantError` — it simply cannot answer.
 *     The primitive exists (`ClickHouseConnection.resolveOrganization`); what
 *     is missing is an organization-keyed accessor on
 *     `ApiClickHouseInfrastructure` and one option threaded to here. Until
 *     then an organization metered in events reads UNKNOWN rather than a
 *     number nothing produced.
 */
import {
  BillableEventsQueryService,
  ClickHouseBillingAdapter,
  deploymentPlanSources,
  type BillingSubscriptionRepository,
} from "@langwatch/enterprise-billing-server";
import type { ClickHouseClient } from "@clickhouse/client";
import type { PlanProvider, UsageUnit } from "@langwatch/entitlement-contract";
import {
  EntitlementService,
  PrismaUsageMembershipRepository,
  resolveUsageMeter,
  USAGE_UNKNOWN,
  UsageCounterPort,
  UsageStatsService,
  type LimitsTrpcPorts,
  type UsageCount,
} from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PricingModel, PrismaClient } from "@langwatch/prisma-client/generated";
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
  abstract absent(source: "licence" | "subscription" | "usage-mail" | "events-meter"): void;
}

/** Writes each absent plan source to the process log, with what it costs. */
export class LoggedApiEntitlementAbsence extends ApiEntitlementAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiEntitlementAbsence {
    return new LoggedApiEntitlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(source: "licence" | "subscription" | "usage-mail" | "events-meter"): void {
    this.logger.warn({ source }, ENTITLEMENT_CONSEQUENCE[source]);
  }
}

const ENTITLEMENT_CONSEQUENCE = {
  licence:
    "API process composed no licence source: a signed licence is not read here, so every organization resolves the deployment's baseline plan or the plan its subscription names, and an entitlement carried only by a licence is never applied.",
  subscription:
    "API process composed no subscription source on a HOSTED deployment: every organization resolves the free baseline, including ones that are paying.",
  "usage-mail":
    "API process composed no mail delivery: the only UsageLimitEmailAdapter in the tree sends nothing and this process reads no mailer configuration, so the approaching-limit mail refuses by name rather than reporting that it sent something.",
  "events-meter":
    "API process publishes no organization-keyed ClickHouse accessor: the billable-events rollup routes on an organization id, which this process's tenant-keyed resolver cannot answer, so an organization metered in EVENTS reads its usage as unknown rather than as a number.",
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
 * No tier enricher is threaded, in either process. `applyPlanTypeEntitlements`
 * fills a tier entitlement only where the resolved plan left it undefined, and
 * every plan these two sources answer already carries the one the tier map
 * names, so it changed no answer here. The leg where it does change one is a
 * signed licence predating a flag, and that leg applies it inside
 * `PlanProviderService` (`@langwatch/enterprise-licensing-server`), which this
 * process composes none of. A tier entitlement the plan table does not carry
 * fails `deployment-plan-sources.unit.test.ts` rather than reaching a customer.
 */
export function composeApiPlanProvider(options: ApiPlanProviderOptions): PlanProvider {
  options.report?.absent("licence");

  const sources = deploymentPlanSources({
    isSaas: options.isSaas,
    ...(options.subscriptions ? { subscriptions: options.subscriptions } : {}),
    ...(options.adminEmails ? { adminEmails: options.adminEmails } : {}),
  });
  if (options.isSaas && !sources.subscription) options.report?.absent("subscription");

  return EntitlementService.create(sources);
}

/** What the usage reading is composed from. */
export type ApiUsageStatsOptions = Readonly<{
  /** The one guarded connection every membership and spend row is read on. */
  prisma: PrismaClient;
  /** The plan the reading is taken against — the SAME one every banner reads. */
  plans: PlanProvider;
  /** The tenant-keyed ClickHouse this process opened, or none. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** Names a refusal, so the mail's absence says which process reached it. */
  processName: string;
  /** Where the two degraded answers are written down. */
  report?: ApiEntitlementAbsenceReport;
}>;

/** Composes the usage reading over this process's own rows and rollups. */
export function composeApiUsageStats(options: ApiUsageStatsOptions): ApiUsageStatsPort {
  options.report?.absent("usage-mail");

  const stats = UsageStatsService.create({
    membership: PrismaUsageMembershipRepository.create(options.prisma),
    counter: ApiUsageCounterAdapter.create(options),
    plans: options.plans,
  });

  return ApiComposedUsageStats.create(stats, options.processName);
}

class ApiComposedUsageStats extends ApiUsageStatsPort {
  static create(stats: UsageStatsService, processName: string): ApiComposedUsageStats {
    return new ApiComposedUsageStats(stats, processName);
  }

  private constructor(
    private readonly stats: UsageStatsService,
    private readonly processName: string,
  ) {
    super();
  }

  ports(): LimitsTrpcPorts {
    return {
      getUsageStats: (_ctx, input) => this.stats.getUsageStats(input.organizationId, input.user),
      checkAndSendWarning: () =>
        Promise.reject(new ApiUsageNotifierUnavailableError(this.processName)),
    };
  }
}

/**
 * The month's volume, and the unit it is counted in.
 *
 * The unit decision is the platform application's, unchanged: a licence's own
 * `usageUnit` wins, then a seat-and-event pricing model, then the free tier,
 * and otherwise traces. What differs here is what happens when the answer is
 * `events` — see the module docblock.
 */
class ApiUsageCounterAdapter extends UsageCounterPort {
  static create(options: ApiUsageStatsOptions): ApiUsageCounterAdapter {
    const resolveClient = options.resolveClickHouseClient;
    return new ApiUsageCounterAdapter(
      options.prisma,
      options.plans,
      BillableEventsQueryService.create(
        resolveClient
          ? ClickHouseBillingAdapter.create({
              resolveClient,
              // Never reached: the only read taken here is the trace rollup,
              // which routes on a project id. An organization-keyed read on a
              // tenant-keyed connection would resolve one tenant's endpoint
              // for another's rows, so it refuses instead of guessing.
              resolveOrganizationClient: () =>
                Promise.reject(new ApiOrganizationRoutedReadUnavailableError(options.processName)),
            }).build()
          : null,
      ),
      options.report,
    );
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly plans: PlanProvider,
    private readonly billing: BillableEventsQueryService,
    private readonly report: ApiEntitlementAbsenceReport | undefined,
  ) {
    super();
  }

  async getCurrentMonthCountForDisplay(input: { organizationId: string }): Promise<UsageCount> {
    const unit = await this.getResolvedUsageUnit(input);
    if (unit === "events") {
      this.report?.absent("events-meter");
      return USAGE_UNKNOWN;
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

/** The approaching-limit mail was asked for on a process with no notifier. */
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

/** An organization-routed ClickHouse read on a tenant-routed connection. */
class ApiOrganizationRoutedReadUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability: "an organization-routed analytics read" },
    });
    this.name = "ApiOrganizationRoutedReadUnavailableError";
  }
}

/** The logger name the two absences above are written under. */
export const API_ENTITLEMENT_LOGGER = "langwatch:api:entitlement";

/** Convenience for the composition root: one report, named once. */
export function apiEntitlementAbsenceReport(serviceName: string): LoggedApiEntitlementAbsence {
  return LoggedApiEntitlementAbsence.create(createLogger(`${serviceName}:entitlement`));
}
