/**
 * Builds {@link EntitlementInfrastructure}. Moved from deleted
 * api-usage.composition.ts; handles absences for subscription, mail, and usage
 * counting on core-tier deployments that cannot compose Enterprise features.
 */
import type { Plan, SendUsageLimitWarningInput, UsageLimitWarning } from "@langwatch/entitlement-contract";
import type { EntitlementSource } from "@langwatch/entitlement-contract";
import { EntitlementNotifierUnavailableError } from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";
import { BASELINES, quotedLimitsOfPlan, type Plan as CataloguePlan } from "@langwatch/plans";
import { USAGE_UNKNOWN, type UsageCounter, type UsageWarning } from "./entitlement.members.ts";
import type { EntitlementAppConfig, EntitlementInfrastructure } from "./entitlement.app.ts";

/** Which plan source this deployment could not compose, said once at composition. */
export abstract class EntitlementAbsenceReport {
  abstract absent(source: "subscription" | "usage-counter" | "usage-mail"): void;
}

/** Writes each absent source to the process log, with what it costs. */
export class LoggedEntitlementAbsence extends EntitlementAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedEntitlementAbsence {
    return new LoggedEntitlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(source: "subscription" | "usage-counter" | "usage-mail"): void {
    this.logger.warn({ source }, ENTITLEMENT_CONSEQUENCE[source]);
  }
}

/** The `subscription` and `usage-mail` strings are ported verbatim from the
 * deleted `apps/api/src/app/api-usage.composition.ts`. */
const ENTITLEMENT_CONSEQUENCE = {
  subscription:
    "API process composed no subscription source on a HOSTED deployment: every organization resolves the free baseline, including ones that are paying.",
  "usage-counter":
    "This module composes no Enterprise billing rollup at core tier, so every organization's month volume reads as unknown rather than a real count, and its metering unit falls back to traces.",
  "usage-mail":
    "API process composed no mail gateway because this deployment named no BASE_HOST: there is no sender address to derive and no host to build the usage link from, so the approaching-limit mail refuses by name rather than reporting that it sent something.",
} as const;

/**
 * The month's billable volume was asked for on a deployment with no
 * Enterprise billing rollup composed. Structurally honest rather than a
 * confident zero: {@link USAGE_UNKNOWN} is the sentinel every reader of
 * {@link UsageCounter} already treats as "the counting store could not
 * answer", which is exactly this module's own situation at core tier.
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
 * The deployment's own starting plan, before any paid source is consulted.
 * Adapted from `@langwatch/plans`'s catalogue rather than the Enterprise
 * billing contract's `PLAN_LIMITS.FREE`: the two are disputed to carry the
 * same numbers (see `packages/plans/src/catalogue-data.ts` `disputed` field),
 * but only the catalogue one is reachable from core tier.
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

/** What this module hands `EntitlementApp` at boot. */
export function buildEntitlementInfrastructure(input: {
  logger: Logger;
  config: EntitlementAppConfig;
  /** The activated license source the process composition root supplied. */
  license: EntitlementSource;
  /** Overridable for tests; defaults to the process logger. */
  report?: EntitlementAbsenceReport;
}): EntitlementInfrastructure {
  const report = input.report ?? LoggedEntitlementAbsence.create(input.logger);

  // Ported from the deleted composition: subscription absence is reported
  // only on a hosted deployment — a self-hosted deployment never had a
  // subscription to miss.
  if (input.config.isSaas) report.absent("subscription");

  return {
    baseline: coreBaseline(input.config.isSaas),
    license: input.license,
    counter: AbsentUsageCounter.create(report),
    warnings: AbsentUsageWarning.create(report, input.config.processName),
  };
}
