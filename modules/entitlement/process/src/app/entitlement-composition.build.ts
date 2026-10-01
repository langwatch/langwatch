/**
 * Builds {@link EntitlementInfrastructure}. Moved from deleted
 * api-usage.composition.ts; handles absences for subscription, mail, and usage
 * counting on core-tier deployments that cannot compose Enterprise features.
 */
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import { applyPlanTypeEntitlements } from "@langwatch/enterprise-licensing-contract";
import {
  type BaselinePlanSource,
  type Plan,
  type ResolvePlanInput,
  type SendUsageLimitWarningInput,
  type UsageLimitWarning,
  type EntitlementApi as EntitlementApiContract,
  type EntitlementGrant,
  type EntitlementSource,
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
import { toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import { findCrossedUsageThreshold } from "../rules/usage-warning-thresholds.rules.ts";
import { EntitlementService } from "../services/entitlement.service.ts";
import { UsageService } from "../services/usage-enforcement.service.ts";
import {
  type CountedUsageReading,
  UsageWarningSweepService,
} from "../services/usage-warning-sweep.service.ts";
import type { EntitlementInfrastructure } from "./entitlement.app.ts";
import { InProcessUsageCache, USAGE_UNKNOWN, type UsageWarning } from "./entitlement.members.ts";

/** The approaching-limit mail: entitlement decides the threshold and counts; billing sends. */
class BillingUsageWarning implements UsageWarning {
  static create(input: {
    billing: Pick<BillingApi, "sendUsageWarning">;
    counter: UsageService;
    plans: EntitlementService;
    peers: EntitlementUsagePeers;
    isSaas: boolean;
    logger: Logger;
  }): BillingUsageWarning {
    const projectIds = (organizationId: string) =>
      input.peers.projects.listIdsByOrganization({ organizationId });
    return new BillingUsageWarning({
      billing: input.billing,
      counter: input.counter,
      projectIds,
      sweep: (send) =>
        UsageWarningSweepService.create({
          isSaas: input.isSaas,
          logger: input.logger,
          organizationIds: () => input.peers.organizations.findAllIds(),
          projectIds,
          countByProjects: (counted) => input.counter.getCurrentMonthCountByProjects(counted),
          activePlan: (organizationId) => input.plans.getActivePlan({ organizationId }),
          send,
        }),
    });
  }

  readonly #sweep: UsageWarningSweepService;
  private readonly billing: Pick<BillingApi, "sendUsageWarning">;
  private readonly counter: UsageService;
  private readonly projectIds: (organizationId: string) => Promise<string[]>;

  private constructor(input: {
    billing: Pick<BillingApi, "sendUsageWarning">;
    counter: UsageService;
    projectIds: (organizationId: string) => Promise<string[]>;
    sweep: (
      send: (input: CountedUsageReading) => Promise<UsageLimitWarning>,
    ) => UsageWarningSweepService;
  }) {
    this.billing = input.billing;
    this.counter = input.counter;
    this.projectIds = input.projectIds;
    this.#sweep = input.sweep((reading) => this.decide(reading));
  }

  /** A caller's reading: counted per project only once a threshold is crossed. */
  async sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    if (findCrossedUsageThreshold(input) === undefined) return { sent: false };
    const { organizationId } = input;
    const projectCounts = await this.counter.getCountByProjects({
      organizationId,
      projectIds: await this.projectIds(organizationId),
    });
    if (projectCounts === USAGE_UNKNOWN) return { sent: false };
    return this.decide({ ...input, projectCounts });
  }

  sweep(): Promise<void> {
    return this.#sweep.sweep();
  }

  private async decide(input: CountedUsageReading): Promise<UsageLimitWarning> {
    const crossedThreshold = findCrossedUsageThreshold(input);
    if (crossedThreshold === undefined) return { sent: false };
    const { sent, notificationId, sentAt } = await this.billing.sendUsageWarning({
      ...input,
      crossedThreshold,
    });
    return {
      sent,
      ...(notificationId === undefined ? {} : { notificationId }),
      ...(sentAt === undefined ? {} : { sentAt: toDate(sentAt) }),
    };
  }
}

/**
 * LangWatch Cloud's plan for an organization, read from billing's subscriptions: main's SaaS
 * plan provider. It is also the Cloud baseline, so a free plan keeps its subscription overrides.
 */
class BillingSubscriptionPlans implements BaselinePlanSource {
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

/** The same subscription plans as a paid source: Cloud always answers a plan, so it grants one. */
class BillingSubscriptionGrants implements EntitlementSource {
  static create(plans: BillingSubscriptionPlans): BillingSubscriptionGrants {
    return new BillingSubscriptionGrants(plans);
  }

  private constructor(private readonly plans: BillingSubscriptionPlans) {}

  async resolve(input: ResolvePlanInput): Promise<EntitlementGrant> {
    return { granted: true, plan: await this.plans.resolve(input) };
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
  billing: Pick<
    BillingApi,
    "countBillableEventsByProjects" | "getPricingModel" | "sendUsageWarning"
  >;
  organizations: Pick<OrganizationApi, "getOrganizationIdByTeamId" | "findAllIds">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
}>;

/** What this module hands `EntitlementModule` at boot. */
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
}): EntitlementInfrastructure {
  // Main composed the subscription provider on Cloud only; self-hosted resolves licences alone.
  const subscription = input.isSaas ? BillingSubscriptionPlans.create(input.billing) : undefined;

  const sources = {
    baseline: subscription ?? coreBaseline(input.isSaas),
    license: input.license,
    subscription: subscription ? BillingSubscriptionGrants.create(subscription) : undefined,
    // Main's PlanProviderService: every leg's plan gets the entitlements its tier grants.
    enrichers: [{ enrich: applyPlanTypeEntitlements }],
  };

  const plans = EntitlementService.create(sources);
  const counter = liveUsageCounter({ isSaas: input.isSaas, plans, peers: input.usage });

  return {
    ...sources,
    counter,
    warnings: BillingUsageWarning.create({
      billing: input.usage.billing,
      counter,
      plans,
      peers: input.usage,
      isSaas: input.isSaas,
      logger: input.logger,
    }),
  };
}
