import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import { createLogger } from "@langwatch/observability";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import type { OrganizationForBilling } from "~/server/app-layer/organizations/repositories/organization.repository";
import { TtlCache } from "~/server/utils/ttlCache";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import {
  BILLABLE_EVENTS_STRIPE_METER_EVENT_NAME,
  MAX_CONSECUTIVE_FAILURES,
} from "../constants";

const logger = createLogger(
  "langwatch:billing-reporting:report-usage-for-month",
);

const ORG_CACHE_TTL_MS = 60 * 1000;

/** Cached for a minute: this sits behind the busiest self-dispatch loop in the
 *  pipeline, and would otherwise run once per report attempt. */
const orgCache = new TtlCache<OrganizationForBilling>(
  ORG_CACHE_TTL_MS,
  "ttlcache:billing:orgData:",
);

export interface ReportUsageForMonthData {
  readonly organizationId: string;
  readonly billingMonth: string;
  /** The group key's `tenantId`: this command's lane is scoped to the
   *  organization, so it always equals `organizationId`. */
  readonly tenantId: string;
  readonly occurredAt: number;
}

export interface ReportUsageForMonthDeps {
  readonly organizations: Pick<
    OrganizationService,
    "getOrganizationForBilling"
  >;
  readonly billingCheckpoints: BillingCheckpointService;
  /** Read per dispatch: usage reporting is SaaS-only, absent from a
   *  self-hosted build entirely. */
  readonly getUsageReportingService: () => UsageReportingService | undefined;
  readonly queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  /** Re-dispatches this same command after a reported delta (the convergence
   *  loop) or a transient Stripe failure. */
  readonly selfDispatch: (data: ReportUsageForMonthData) => Promise<void>;
}

/** Deterministic, so a repeated report of the same delta lands as the same
 *  Stripe event rather than double-charging. */
function buildIdentifier(params: {
  organizationId: string;
  billingMonth: string;
  lastReportedTotal: number;
  targetTotal: number;
}): string {
  const { organizationId, billingMonth, lastReportedTotal, targetTotal } =
    params;
  return `${organizationId}:${billingMonth}:from:${lastReportedTotal}:to:${targetTotal}`;
}

/**
 * Reports one organization's usage for one billing month to Stripe.
 *
 * Never throws to its caller: every failure it can identify is logged,
 * checkpointed and where appropriate retried through `selfDispatch`. "The
 * dispatch could not be staged" is the poke's and the sweep's class, and they
 * raise it.
 *
 * Two-phase checkpoint, so a crash between "Stripe accepted" and "we recorded
 * that" cannot re-report or drop the delta. A pending total found on entry is
 * reused — same Stripe identifier — rather than re-queried.
 */
export async function reportUsageForMonth(
  data: ReportUsageForMonthData,
  deps: ReportUsageForMonthDeps,
): Promise<void> {
  const { organizationId, billingMonth } = data;

  let shouldSelfDispatch = false;
  try {
    let org = (await orgCache.get(organizationId)) ?? null;
    if (!org) {
      org = await deps.organizations.getOrganizationForBilling(organizationId);
      if (org) {
        await orgCache.set(organizationId, org);
      }
    }

    if (!org) {
      logger.warn(
        { organizationId },
        "organization not found or not SEAT_EVENT, skipping",
      );
      return;
    }
    if (!org.stripeCustomerId) {
      logger.debug(
        { organizationId },
        "no Stripe customer ID, skipping usage reporting",
      );
      return;
    }
    if (org.subscriptions.length === 0) {
      logger.debug(
        { organizationId },
        "no active subscription, skipping usage reporting",
      );
      return;
    }

    shouldSelfDispatch = await reportForBillingMonth({
      organizationId,
      billingMonth,
      stripeCustomerId: org.stripeCustomerId,
      deps,
    });
  } catch (error) {
    logger.error(
      { organizationId, billingMonth, error },
      "unexpected error reporting usage",
    );
    await withScope(async (scope) => {
      scope.setTag?.("handler", "reportUsageForMonth");
      scope.setExtra?.("organizationId", organizationId);
      scope.setExtra?.("billingMonth", billingMonth);
      captureException(toError(error));
    });
    return;
  }

  // Outside the try/catch above: a failure to self-dispatch (staging failed,
  // not the Stripe call) belongs to the caller's retry budget, same as the
  // poke and the sweep's own dispatch failures.
  if (shouldSelfDispatch) {
    await deps.selfDispatch({ ...data, occurredAt: Date.now() });
  }
}

async function reportForBillingMonth(params: {
  organizationId: string;
  billingMonth: string;
  stripeCustomerId: string;
  deps: ReportUsageForMonthDeps;
}): Promise<boolean> {
  const { organizationId, billingMonth, stripeCustomerId, deps } = params;

  const checkpoint = await deps.billingCheckpoints.getCheckpoint({
    organizationId,
    billingMonth,
  });
  const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;
  const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;
  const circuitTripped = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

  if (circuitTripped) {
    // Loud, not a give-up: Stripe is still attempted below, and only the
    // immediate self-dispatch loop is paused. Skipping the attempt would latch
    // this organization out of invoicing forever.
    logger.error(
      { organizationId, billingMonth, consecutiveFailures },
      "ALARM: consecutive Stripe failures exceeded threshold -- self-dispatch convergence paused, but this organization is still retried on the next independent poke or sweep tick, not abandoned. Manual investigation required.",
    );
  }

  let targetTotal: number;
  if (checkpoint?.pendingReportedTotal != null) {
    targetTotal = checkpoint.pendingReportedTotal;
    logger.info(
      { organizationId, billingMonth, targetTotal, lastReportedTotal },
      "recovering pending checkpoint from previous crash",
    );
  } else {
    const currentTotal = await deps.queryBillableEventsTotal({
      organizationId,
      billingMonth,
    });
    if (currentTotal === null) {
      return false; // ClickHouse not available
    }
    if (currentTotal <= lastReportedTotal) {
      logger.debug(
        { organizationId, billingMonth, currentTotal, lastReportedTotal },
        "no new billable events, skipping",
      );
      return false;
    }
    targetTotal = currentTotal;
    await deps.billingCheckpoints.writeIntent({
      organizationId,
      billingMonth,
      lastReportedTotal,
      pendingReportedTotal: targetTotal,
    });
  }

  const delta = targetTotal - lastReportedTotal;
  if (delta <= 0) {
    logger.debug(
      { organizationId, billingMonth, targetTotal, lastReportedTotal },
      "non-positive delta, skipping Stripe report",
    );
    return false;
  }

  const identifier = buildIdentifier({
    organizationId,
    billingMonth,
    lastReportedTotal,
    targetTotal,
  });

  const usageReportingService = deps.getUsageReportingService();
  if (!usageReportingService) {
    logger.error(
      { organizationId, billingMonth },
      "usageReportingService not available -- billing requires isSaas, this is a configuration error",
    );
    return false;
  }

  try {
    const results = await usageReportingService.reportUsageDelta({
      stripeCustomerId,
      organizationId,
      events: [
        {
          eventName: BILLABLE_EVENTS_STRIPE_METER_EVENT_NAME,
          identifier,
          timestamp: Math.floor(Date.now() / 1000),
          value: delta,
        },
      ],
    });

    const result = results[0];
    if (!result || !result.reported) {
      logger.error(
        {
          organizationId,
          billingMonth,
          identifier,
          delta,
          error: result?.error,
        },
        "Stripe permanently rejected meter event, checkpoint NOT updated",
      );
      await withScope(async (scope) => {
        scope.setTag?.("handler", "reportUsageForMonth");
        scope.setExtra?.("organizationId", organizationId);
        scope.setExtra?.("identifier", identifier);
        scope.setExtra?.("delta", delta);
        scope.setExtra?.("stripeError", result?.error);
        captureException(
          new Error(
            `Stripe rejected meter event: ${result?.error ?? "unknown"}`,
          ),
        );
      });
      // Clear pending so subsequent runs don't replay the rejected delta forever.
      await deps.billingCheckpoints.clearPendingAndIncrementFailures({
        organizationId,
        billingMonth,
        consecutiveFailures: consecutiveFailures + 1,
      });
      return false;
    }

    // The only place `consecutiveFailures` returns to 0 — including after a
    // report attempted while the breaker was tripped, which is what makes
    // recovery automatic.
    await deps.billingCheckpoints.confirm({
      organizationId,
      billingMonth,
      lastReportedTotal: targetTotal,
    });
    logger.debug(
      { organizationId, billingMonth, identifier, delta, targetTotal },
      "usage reported and checkpoint updated successfully",
    );
    return true;
  } catch (error) {
    logger.warn(
      { organizationId, billingMonth, error },
      "transient error reporting usage to Stripe",
    );
    await deps.billingCheckpoints.incrementFailures({
      organizationId,
      billingMonth,
      lastReportedTotal,
      pendingReportedTotal: targetTotal,
      consecutiveFailures: consecutiveFailures + 1,
    });
    // Retry immediately only while the breaker has not tripped; once it has,
    // the next independent poke or sweep tick is the escape path.
    return !circuitTripped;
  }
}
