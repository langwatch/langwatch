/**
 * Builds {@link EntitlementInfrastructure}. Moved from deleted
 * api-usage.composition.ts; handles absences for subscription, mail, and usage
 * counting on core-tier deployments that cannot compose Enterprise features.
 */
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import {
  type BaselinePlanSource,
  type Plan,
  type ResolvePlanInput,
  type SendUsageLimitWarningInput,
  type UsageLimitWarning,
  type EntitlementApi as EntitlementApiContract,
  type EntitlementSource,
  EntitlementNotifierUnavailableError,
} from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  BASELINES,
  findRequestBound,
  quotedLimitsOfPlan,
  type Plan as CataloguePlan,
} from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import { EntitlementService } from "../services/entitlement.service.ts";
import { UsageService } from "../services/usage-enforcement.service.ts";
import type { EntitlementInfrastructure } from "./entitlement.app.ts";
import { InProcessUsageCache, type UsageWarning } from "./entitlement.members.ts";

/** Which plan source this deployment could not compose, said once at composition. */
export abstract class EntitlementAbsenceReport {
  abstract absent(source: "usage-mail"): void;
}

/** Writes each absent source to the process log, with what it costs. */
export class LoggedEntitlementAbsence extends EntitlementAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedEntitlementAbsence {
    return new LoggedEntitlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(source: "usage-mail"): void {
    this.logger.warn({ source }, ENTITLEMENT_CONSEQUENCE[source]);
  }
}

/** The `usage-mail` string is ported verbatim from the deleted `api-usage.composition.ts`. */
const ENTITLEMENT_CONSEQUENCE = {
  "usage-mail":
    "API process composed no mail gateway because this deployment named no BASE_HOST: there is no sender address to derive and no host to build the usage link from, so the approaching-limit mail refuses by name rather than reporting that it sent something.",
} as const;

/**
 * The approaching-limit mail, on a deployment that composed no Enterprise
 * billing gateway. Refuses by name rather than reporting that it sent
 * something, exactly like the deleted composition's own `ApiComposedUsageWarnings`.
 */
class AbsentUsageWarning implements UsageWarning {
  static create(report: EntitlementAbsenceReport, processName: string): AbsentUsageWarning {
    report.absent("usage-mail");

    return new AbsentUsageWarning(processName);
  }

  private constructor(private readonly processName: string) {}

  async sendWarning(_input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    throw new EntitlementNotifierUnavailableError(this.processName);
  }
}

/**
 * LangWatch Cloud's plan for an organization, read from billing's subscriptions: main's SaaS
 * plan provider. It is also the Cloud baseline, so a free plan keeps its subscription overrides.
 */
class BillingSubscriptionPlans implements EntitlementSource, BaselinePlanSource {
  static create(billing: Pick<BillingApi, "getActiveSubscriptionPlan">): BillingSubscriptionPlans {
    return new BillingSubscriptionPlans(billing);
  }

  private constructor(private readonly billing: Pick<BillingApi, "getActiveSubscriptionPlan">) {}

  resolve(input: ResolvePlanInput): Promise<Plan> {
    return this.billing.getActiveSubscriptionPlan({
      organizationId: input.organizationId,
      user: input.user,
    });
  }
}

/**
 * The deployment's own starting plan, before any paid source is consulted.
 * Adapted from `@langwatch/plans`'s catalogue, not the Enterprise contract's
 * `PLAN_LIMITS.FREE` — disputed to match (catalogue-data.ts's `disputed` field).
 */
function coreBaseline(isSaas: boolean): Plan {
  const plan: CataloguePlan = isSaas ? BASELINES.cloud : BASELINES["self-hosted"];

  return {
    planSource: "free",
    type: plan.type,
    name: plan.name,
    free: plan.free,
    ...quotedLimitsOfPlan(plan),
  };
}

/**
 * The request-bound seam for a process that composes no entitlement graph at
 * all: every bound answers its free-tier value — the same fail-open answer
 * an unknown plan type gets from `resolveRequestBound`.
 */
export function createAbsentRequestBound(): Pick<EntitlementApiContract, "requestBound"> {
  return {
    async requestBound({ key }) {
      const bound = findRequestBound(key);
      if (bound === undefined) {
        throw new Error(`Unknown request bound: ${key}.`);
      }
      return bound.free;
    },
  };
}

/** Main's 30-second count and meter-decision windows. */
const USAGE_CACHE_TTL_MS = 30_000;

/** Main's `UsageService` over the owners' counts: trace's traces, billing's events and pricing. */
function liveUsageCounter(input: {
  isSaas: boolean;
  plans: EntitlementService;
  peers: EntitlementUsagePeers;
}): UsageService {
  const { traces, billing, organizations, projects } = input.peers;

  return UsageService.create({
    organizations: {
      getOrganizationIdByTeamId: (lookup) => organizations.getOrganizationIdByTeamId(lookup),
      getProjectIds: (organizationId) => projects.listIdsByOrganization({ organizationId }),
      getPricingModel: (organizationId) => billing.getPricingModel({ organizationId }),
    },
    traceCounter: { getCountByProjects: (counted) => traces.countTracesByProjects(counted) },
    eventCounter: {
      getCountByProjects: (counted) => billing.countBillableEventsByProjects(counted),
    },
    planResolver: (organizationId) => input.plans.getActivePlan({ organizationId }),
    deployment: { isSaas: input.isSaas },
    countCache: new InProcessUsageCache(USAGE_CACHE_TTL_MS),
    decisionCache: new InProcessUsageCache(USAGE_CACHE_TTL_MS),
  });
}

/** The peers the live usage count reads through. */
export type EntitlementUsagePeers = Readonly<{
  traces: Pick<TraceApi, "countTracesByProjects">;
  billing: Pick<BillingApi, "countBillableEventsByProjects" | "getPricingModel">;
  organizations: Pick<OrganizationApi, "getOrganizationIdByTeamId">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
}>;

/** What this module hands `EntitlementApp` at boot. */
export function buildEntitlementInfrastructure(input: {
  logger: Logger;
  /** OUT OF SCOPE for this port; carried through exactly as before. */
  isSaas: boolean;
  processName: string;
  /** The activated license source the process composition root supplied. */
  license: EntitlementSource;
  /** Where LangWatch Cloud's subscription plans are read; unused off Cloud. */
  billing: Pick<BillingApi, "getActiveSubscriptionPlan">;
  /** Where the month's usage is counted. */
  usage: EntitlementUsagePeers;
  /** Overridable for tests; defaults to the process logger. */
  report?: EntitlementAbsenceReport;
}): EntitlementInfrastructure {
  const report = input.report ?? LoggedEntitlementAbsence.create(input.logger);

  // Main composed the subscription provider on Cloud only; self-hosted resolves licences alone.
  const subscription = input.isSaas ? BillingSubscriptionPlans.create(input.billing) : undefined;

  const sources = {
    baseline: subscription ?? coreBaseline(input.isSaas),
    license: input.license,
    subscription,
  };

  return {
    ...sources,
    counter: liveUsageCounter({
      isSaas: input.isSaas,
      plans: EntitlementService.create(sources),
      peers: input.usage,
    }),
    warnings: AbsentUsageWarning.create(report, input.processName),
  };
}
