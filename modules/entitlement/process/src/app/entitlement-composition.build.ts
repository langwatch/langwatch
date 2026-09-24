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
import {
  BASELINES,
  findRequestBound,
  quotedLimitsOfPlan,
  type Plan as CataloguePlan,
} from "@langwatch/plans";

import type { EntitlementInfrastructure } from "./entitlement.app.ts";
import { USAGE_UNKNOWN, type UsageCounter, type UsageWarning } from "./entitlement.members.ts";

/** Which plan source this deployment could not compose, said once at composition. */
export abstract class EntitlementAbsenceReport {
  abstract absent(source: "usage-counter" | "usage-mail"): void;
}

/** Writes each absent source to the process log, with what it costs. */
export class LoggedEntitlementAbsence extends EntitlementAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedEntitlementAbsence {
    return new LoggedEntitlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(source: "usage-counter" | "usage-mail"): void {
    this.logger.warn({ source }, ENTITLEMENT_CONSEQUENCE[source]);
  }
}

/** The `usage-mail` string is ported verbatim from the deleted `api-usage.composition.ts`. */
const ENTITLEMENT_CONSEQUENCE = {
  "usage-counter":
    "This module composes no Enterprise billing rollup at core tier, so every organization's month volume reads as unknown rather than a real count, and its metering unit falls back to traces.",
  "usage-mail":
    "API process composed no mail gateway because this deployment named no BASE_HOST: there is no sender address to derive and no host to build the usage link from, so the approaching-limit mail refuses by name rather than reporting that it sent something.",
} as const;

/**
 * The month's billable volume was asked for on a deployment with no
 * Enterprise billing rollup composed. {@link USAGE_UNKNOWN} is what every
 * {@link UsageCounter} reader treats as "the counting store could not answer".
 */
class AbsentUsageCounter implements UsageCounter {
  static create(report: EntitlementAbsenceReport): AbsentUsageCounter {
    report.absent("usage-counter");

    return new AbsentUsageCounter();
  }

  private constructor() {}

  async getCurrentMonthCountForDisplay(): Promise<typeof USAGE_UNKNOWN> {
    return USAGE_UNKNOWN;
  }

  async getResolvedUsageUnit(): Promise<"traces"> {
    return "traces";
  }
}

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
  /** Overridable for tests; defaults to the process logger. */
  report?: EntitlementAbsenceReport;
}): EntitlementInfrastructure {
  const report = input.report ?? LoggedEntitlementAbsence.create(input.logger);

  // Main composed the subscription provider on Cloud only; self-hosted resolves licences alone.
  const subscription = input.isSaas ? BillingSubscriptionPlans.create(input.billing) : undefined;

  return {
    baseline: subscription ?? coreBaseline(input.isSaas),
    license: input.license,
    subscription,
    counter: AbsentUsageCounter.create(report),
    warnings: AbsentUsageWarning.create(report, input.processName),
  };
}
