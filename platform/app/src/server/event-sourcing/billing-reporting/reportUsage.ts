import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import type { OrganizationForBilling } from "~/server/app-layer/organizations/repositories/organization.repository";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:billing-reporting:report-usage");

/** Consecutive Stripe failures before the circuit-breaker trips. */
const MAX_CONSECUTIVE_FAILURES = 5;
const BILLABLE_EVENTS_STRIPE_METER_EVENT_NAME = "langwatch_billable_events";

export const reportUsagePayloadSchema = z.object({
  organizationId: z.string(),
  billingMonth: z.string(),
  /** The group key's `tenantId`: this process is scoped to the organization,
   *  so it always equals `organizationId`. */
  tenantId: z.string(),
  occurredAt: z.number(),
});
export type ReportUsagePayload = z.infer<typeof reportUsagePayloadSchema>;

/** What one report attempt did, so a caller dispatching many (the sweep) or
 *  one (the poke) can decide whether to raise for a retry. */
export type ReportUsageOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: Error };

/** The billing organization read, cached: this sits behind the busiest
 *  dispatch loop in the pipeline and would otherwise run once per report
 *  attempt. */
export interface OrganizationCache {
  get(organizationId: string): Promise<OrganizationForBilling | undefined>;
  set(organizationId: string, org: OrganizationForBilling): Promise<void>;
}

/** Shared by the poke's own `reportUsage` intent and the sweep's per-organization
 *  dispatch — one Stripe-reporting path, never two. */
export interface ReportUsagePorts {
  readonly organizations: Pick<
    OrganizationService,
    "getOrganizationForBilling"
  >;
  readonly organizationCache: OrganizationCache;
  readonly billingCheckpoints: BillingCheckpointService;
  /** Read per dispatch: usage reporting is SaaS-only, absent from a
   *  self-hosted build entirely. */
  readonly getUsageReportingService: () => UsageReportingService | undefined;
  readonly queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
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
 * Two-phase checkpoint, so a crash between "Stripe accepted" and "we recorded
 * that" cannot re-report or drop the delta. A pending total found on entry is
 * reused — same Stripe identifier — rather than re-queried.
 *
 * Unlike the pre-conversion command, this never re-dispatches itself: an
 * intent's `deliver` is a leaf (ADR-105) and cannot emit a further intent, so
 * a delta that keeps growing under sustained load converges on the next
 * billable event's poke or the next hourly sweep rather than immediately —
 * see this pipeline's report for the adjudication this narrowing needs.
 */
async function reportForBillingMonth(
  ports: ReportUsagePorts,
  params: {
    organizationId: string;
    billingMonth: string;
    stripeCustomerId: string;
  },
): Promise<ReportUsageOutcome> {
  const { organizationId, billingMonth, stripeCustomerId } = params;

  const checkpoint = await ports.billingCheckpoints.getCheckpoint({
    organizationId,
    billingMonth,
  });
  const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;
  const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;
  const circuitTripped = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

  if (circuitTripped) {
    // Loud, not a give-up: Stripe is still attempted below.
    logger.error(
      { organizationId, billingMonth, consecutiveFailures },
      "ALARM: consecutive Stripe failures exceeded threshold -- this organization is still retried on the next poke or sweep tick, not abandoned. Manual investigation required.",
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
    const currentTotal = await ports.queryBillableEventsTotal({
      organizationId,
      billingMonth,
    });
    if (currentTotal === null) return { ok: true }; // ClickHouse not available
    if (currentTotal <= lastReportedTotal) {
      logger.debug(
        { organizationId, billingMonth, currentTotal, lastReportedTotal },
        "no new billable events, skipping",
      );
      return { ok: true };
    }
    targetTotal = currentTotal;
    await ports.billingCheckpoints.writeIntent({
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
    return { ok: true };
  }

  const identifier = buildIdentifier({
    organizationId,
    billingMonth,
    lastReportedTotal,
    targetTotal,
  });
  const usageReportingService = ports.getUsageReportingService();
  if (!usageReportingService) {
    logger.error(
      { organizationId, billingMonth },
      "usageReportingService not available -- billing requires isSaas, this is a configuration error",
    );
    return { ok: true };
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
    if (!result?.reported) {
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
      // Clearing pending drops the recovered target, not the delta: the next
      // run re-reads the same level and re-submits the identical identifier.
      await ports.billingCheckpoints.clearPendingAndIncrementFailures({
        organizationId,
        billingMonth,
        consecutiveFailures: consecutiveFailures + 1,
      });
      // A permanent rejection re-fails identically on an immediate retry, so
      // this is not escalated — it converges via the checkpoint on the next
      // independently-scheduled poke or sweep, same as before.
      return { ok: true };
    }

    await ports.billingCheckpoints.confirm({
      organizationId,
      billingMonth,
      lastReportedTotal: targetTotal,
    });
    logger.debug(
      { organizationId, billingMonth, identifier, delta, targetTotal },
      "usage reported and checkpoint updated successfully",
    );
    return { ok: true };
  } catch (error) {
    logger.warn(
      { organizationId, billingMonth, error },
      "transient error reporting usage to Stripe",
    );
    await ports.billingCheckpoints.incrementFailures({
      organizationId,
      billingMonth,
      lastReportedTotal,
      pendingReportedTotal: targetTotal,
      consecutiveFailures: consecutiveFailures + 1,
    });
    // Mirrors the retired command's `return !circuitTripped`: a tripped
    // circuit no longer demands an immediate retry of the whole tick — the
    // next independently-scheduled poke or sweep attempts Stripe again
    // regardless.
    return circuitTripped ? { ok: true } : { ok: false, error: toError(error) };
  }
}

/**
 * Resolves the organization, applies its skip conditions, then reports.
 *
 * Never throws — the caller (the poke, one organization at a time; the
 * sweep, many) decides whether the returned outcome is worth raising for a
 * retry, per its own dispatch shape.
 */
export async function reportUsage(
  ports: ReportUsagePorts,
  payload: ReportUsagePayload,
): Promise<ReportUsageOutcome> {
  const { organizationId, billingMonth } = payload;
  try {
    let org = (await ports.organizationCache.get(organizationId)) ?? null;
    if (!org) {
      org = await ports.organizations.getOrganizationForBilling(organizationId);
      if (org) await ports.organizationCache.set(organizationId, org);
    }
    if (!org) {
      logger.warn(
        { organizationId },
        "organization not found or not SEAT_EVENT, skipping",
      );
      return { ok: true };
    }
    if (!org.stripeCustomerId) {
      logger.debug(
        { organizationId },
        "no Stripe customer ID, skipping usage reporting",
      );
      return { ok: true };
    }
    if (org.subscriptions.length === 0) {
      logger.debug(
        { organizationId },
        "no active subscription, skipping usage reporting",
      );
      return { ok: true };
    }

    return await reportForBillingMonth(ports, {
      organizationId,
      billingMonth,
      stripeCustomerId: org.stripeCustomerId,
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
    return { ok: false, error: toError(error) };
  }
}
