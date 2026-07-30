import { createLogger } from "@langwatch/observability";
import type { queryBillableEventsTotal as QueryBillableEventsTotalFn } from "@ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "@ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "~/server/app-layer/billing/billingCheckpoint.service";
import type { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import type { OrganizationForBilling } from "~/server/app-layer/organizations/repositories/organization.repository";
import { TtlCache } from "~/server/utils/ttlCache";
import { captureException, toError, withScope } from "~/utils/posthogErrorCapture";
import { BILLABLE_EVENTS_STRIPE_METER_EVENT_NAME, MAX_CONSECUTIVE_FAILURES } from "../constants";

const logger = createLogger("langwatch:billing-reporting:report-usage-for-month");

const ORG_CACHE_TTL_MS = 60 * 1000;

/**
 * A `getOrganizationForBilling` result, cached for a minute: this handler
 * sits behind the busiest self-dispatch loop in the pipeline, and the lookup
 * would otherwise run once per report attempt.
 */
const orgCache = new TtlCache<OrganizationForBilling>(ORG_CACHE_TTL_MS, "ttlcache:billing:orgData:");

export interface ReportUsageForMonthData {
  readonly organizationId: string;
  readonly billingMonth: string;
  /**
   * Present so a dispatcher can use it as the group key's `tenantId` (ADR-100
   * scopes this command's lane to the organization, not any one project) —
   * always equal to `organizationId` for this command.
   */
  readonly tenantId: string;
  readonly occurredAt: number;
}

export interface ReportUsageForMonthDeps {
  readonly organizations: Pick<OrganizationService, "getOrganizationForBilling">;
  readonly billingCheckpoints: BillingCheckpointService;
  /**
   * Read per dispatch rather than held: usage reporting is SaaS-only and is
   * absent from a self-hosted build entirely.
   */
  readonly getUsageReportingService: () => UsageReportingService | undefined;
  readonly queryBillableEventsTotal: typeof QueryBillableEventsTotalFn;
  /**
   * Re-dispatches this same command when a delta was reported (the
   * convergence loop) or a transient Stripe failure needs a retry. A plain
   * closure, not a command-bus port: there is no command-bus in
   * `@langwatch/event-sourcing` yet, and `index.ts`'s
   * `createBillingReportingPipeline` binds this to itself directly.
   */
  readonly selfDispatch: (data: ReportUsageForMonthData) => Promise<void>;
}

/**
 * Builds a deterministic idempotency key for a Stripe meter event, so a
 * repeated report of the same delta (a retry, a re-dispatch after a crash)
 * reports as the same Stripe event rather than double-charging.
 */
function buildIdentifier(params: {
  organizationId: string;
  billingMonth: string;
  lastReportedTotal: number;
  targetTotal: number;
}): string {
  const { organizationId, billingMonth, lastReportedTotal, targetTotal } = params;
  return `${organizationId}:${billingMonth}:from:${lastReportedTotal}:to:${targetTotal}`;
}

/**
 * Reports one organization's usage for one billing month to Stripe.
 *
 * Deliberately never throws to its caller (ADR-098's subscriber contract
 * says a subscriber's own fan-out must be total; this command is dispatched
 * from exactly such a seam). Every failure this handler can identify —
 * missing org, no Stripe customer, no subscription, ClickHouse unavailable, a
 * transient or permanent Stripe rejection — is handled internally: logged,
 * checkpointed, and where appropriate retried through `selfDispatch` rather
 * than surfaced as a rejected promise. This is a *different* failure class
 * from "the dispatch itself could not be staged", which is the poke's and the
 * sweep's own concern (`billingMeterPoke.ts`, `billingMeterSweep.ts`) and is
 * raised, not swallowed, exactly because it happens one layer up from here.
 *
 * Two-phase checkpoint protocol, so a crash between "Stripe accepted the
 * event" and "we recorded that" cannot silently re-report or silently drop
 * the delta:
 *
 *   1. `writeIntent` — write `pendingReportedTotal` before calling Stripe.
 *   2. call Stripe with a delta and a deterministic identifier.
 *   3. `confirm` — promote `pendingReportedTotal` to `lastReportedTotal`.
 *
 * A checkpoint with `pendingReportedTotal` already set (found on entry) means
 * step 2 or 3 never completed last time; recovery reuses that pending value
 * — and therefore the *same* Stripe identifier — rather than re-querying
 * ClickHouse for a fresh total, so a crash-and-retry cannot silently report a
 * different delta than the one Stripe may already have received.
 *
 * **The give-up counter cannot latch.** `consecutiveFailures` crossing
 * `MAX_CONSECUTIVE_FAILURES` never skips the Stripe attempt — only skipping
 * would make `confirm()` (the sole place the counter resets to 0) forever
 * unreachable, silently ending that organization's invoicing. It only pauses
 * this call's own *immediate* self-dispatch (an un-throttled recursive retry
 * — see `index.ts`'s docblock on why there is no queue-level debounce on it
 * yet); the next independently-triggered poke or sweep tick still attempts
 * Stripe at its own safe cadence, so a real recovery on Stripe's side is
 * picked up automatically rather than requiring a manual checkpoint edit.
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
      logger.warn({ organizationId }, "organization not found or not SEAT_EVENT, skipping");
      return;
    }
    if (!org.stripeCustomerId) {
      logger.debug({ organizationId }, "no Stripe customer ID, skipping usage reporting");
      return;
    }
    if (org.subscriptions.length === 0) {
      logger.debug({ organizationId }, "no active subscription, skipping usage reporting");
      return;
    }

    shouldSelfDispatch = await reportForBillingMonth({
      organizationId,
      billingMonth,
      stripeCustomerId: org.stripeCustomerId,
      deps,
    });
  } catch (error) {
    logger.error({ organizationId, billingMonth, error }, "unexpected error reporting usage");
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

  const checkpoint = await deps.billingCheckpoints.getCheckpoint({ organizationId, billingMonth });
  const lastReportedTotal = checkpoint?.lastReportedTotal ?? 0;
  const consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;
  const circuitTripped = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

  if (circuitTripped) {
    // Loud, not a silent give-up: this organization is not skipped. Below,
    // Stripe is still attempted — the escape path — and only the immediate
    // self-dispatch convergence loop is paused once the breaker trips (see
    // the `return !circuitTripped` on the transient-error path). Skipping the
    // attempt outright here would latch the org permanently: `confirm()` is
    // the only place `consecutiveFailures` resets to 0, and `confirm()` is
    // only reached by a successful Stripe call, which a hard skip would make
    // unreachable forever — this organization would never be invoiced again,
    // silently. The next independently-triggered poke or sweep tick (a safe,
    // bounded cadence — 5 minutes / hourly, not a tight loop) still calls
    // this function fresh, so recovery happens on its own once Stripe does.
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
    const currentTotal = await deps.queryBillableEventsTotal({ organizationId, billingMonth });
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

  const identifier = buildIdentifier({ organizationId, billingMonth, lastReportedTotal, targetTotal });

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
        { organizationId, billingMonth, identifier, delta, error: result?.error },
        "Stripe permanently rejected meter event, checkpoint NOT updated",
      );
      await withScope(async (scope) => {
        scope.setTag?.("handler", "reportUsageForMonth");
        scope.setExtra?.("organizationId", organizationId);
        scope.setExtra?.("identifier", identifier);
        scope.setExtra?.("delta", delta);
        scope.setExtra?.("stripeError", result?.error);
        captureException(new Error(`Stripe rejected meter event: ${result?.error ?? "unknown"}`));
      });
      // Clear pending so subsequent runs don't replay the rejected delta forever.
      await deps.billingCheckpoints.clearPendingAndIncrementFailures({
        organizationId,
        billingMonth,
        consecutiveFailures: consecutiveFailures + 1,
      });
      return false;
    }

    // The reset: the only place `consecutiveFailures` returns to 0, reached
    // exactly when Stripe accepts the report — including a report attempted
    // while the breaker was tripped, which is what makes recovery automatic.
    await deps.billingCheckpoints.confirm({ organizationId, billingMonth, lastReportedTotal: targetTotal });
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
    // Self-dispatch (the immediate, un-debounced recursive retry — see
    // index.ts) only while the breaker has not already tripped: once it has,
    // the escape path above is the next INDEPENDENT poke or sweep tick, not
    // another immediate retry stacked on top of 5+ already-failed ones.
    return !circuitTripped;
  }
}
