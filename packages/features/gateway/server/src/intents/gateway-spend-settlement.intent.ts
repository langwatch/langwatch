import type { IntentContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { OpenAdmission } from "../ports/gateway-open-admissions.port";
import type { SettleSpendCommandData } from "../processes/gateway-spend-commands.process";

const logger = createLogger("langwatch:gateway-spend:settlement");

/**
 * The settlement grace: how long an admission may sit without a
 * confirmation or failure before the sweeper settles it as
 * cost-unknown. The bound is sized for the SLOWEST legitimate request,
 * not the median: a long streaming generation can hold a connection for
 * many minutes, and the confirm only ships after the stream closes plus
 * the emitter's spool flush and drain. 30 minutes is comfortably past
 * any provider's stream ceiling while still bounding how stale the
 * billing ledger can be, and settling early is recoverable by design: a
 * late confirmation supersedes the settled record and delivers the
 * superseding completed envelope.
 */
export const SETTLEMENT_GRACE_MS_DEFAULT = 30 * 60 * 1000;

/**
 * How far back a sweep looks.
 *
 * `OccurredAt` is the spend table's partition key, so this bound is what keeps
 * the scan on the two most recent partitions instead of every month in the
 * 13-month retention, including the cold ones on object storage.
 *
 * Seven days is far past any grace an operator can configure, so the only
 * rows it excludes are ones a sweep already had many chances to settle. An
 * admission older than this stays visible as `admitted` in the spend record,
 * which is what already happened to anything the previous per-request timer
 * missed.
 */
export const SETTLEMENT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sanity cap on one sweep. The steady-state population is the handful of
 * requests whose confirmation genuinely never arrived; a result this large
 * means something upstream stopped confirming, and settling a hundred
 * thousand live requests is the one outcome this must never produce.
 *
 * Applied TWICE, and both are load-bearing: once per ClickHouse instance, to
 * bound the query's own result, and again where the instances are merged, so
 * the number this sweep settles is the cap rather than the cap times the
 * number of instances.
 *
 * Lives with the sweep that reports on hitting it rather than beside the query
 * it bounds; the repository and the merging adapter both import it from here,
 * which is a one-way edge.
 */
export const MAX_OPEN_ADMISSIONS_PER_SWEEP = 10_000;

/**
 * Operator override, epoch-milliseconds. Bounded below so a typo cannot
 * turn every in-flight request into a settlement storm.
 *
 * The raw value arrives as an argument rather than being read here: a
 * reusable package receives typed configuration, and the composition root
 * that owns the environment passes `LW_SPEND_SETTLEMENT_GRACE_MS` in. The
 * parse and its warning stay in one place so the REST settlement policy and
 * the sweeper cannot disagree about what the operator asked for.
 */
export function settlementGraceMs(raw: string | undefined): number {
  if (!raw) return SETTLEMENT_GRACE_MS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    logger.warn(
      { raw },
      "ignoring invalid LW_SPEND_SETTLEMENT_GRACE_MS; using the default",
    );
    return SETTLEMENT_GRACE_MS_DEFAULT;
  }
  return parsed;
}

export interface SpendSettlementProcessDeps {
  /** Sends the settleSpend command into this pipeline. Injected lazily so
   *  the process manager can be registered while the pipeline is built. */
  sendSettleSpend: (data: SettleSpendCommandData) => Promise<void>;
  /** Every ClickHouse instance's open admissions. One sweeper settles the
   *  shared instance and every private one. */
  findOpenAdmissions: (params: {
    now: number;
    graceMs: number;
    lookbackMs: number;
  }) => Promise<OpenAdmission[]>;
  /** The operator-configured grace. Absent falls back to the default, which
   *  is what a composition root that supplies none is asking for. */
  graceMs?: number;
  lookbackMs?: number;
  now?: () => number;
}

/**
 * Settles every admission past its grace.
 *
 * Best-effort per row: one tenant's failed send must not cost the rest of
 * the sweep, because the next wake would find the same backlog plus another
 * interval of it. A row that fails is left open and retried on the next
 * sweep, which is exactly what the sweep is for.
 */
export function runSpendSettlementSweep(deps: SpendSettlementProcessDeps) {
  return async (
    _payload: { scheduledFor: number },
    context: IntentContext,
  ): Promise<void> => {
    const now = (deps.now ?? Date.now)();
    const graceMs = deps.graceMs ?? SETTLEMENT_GRACE_MS_DEFAULT;
    const open = await deps.findOpenAdmissions({
      now,
      graceMs,
      lookbackMs: deps.lookbackMs ?? SETTLEMENT_LOOKBACK_MS,
    });
    if (open.length === 0) return;

    let settled = 0;
    let failed = 0;
    for (const admission of open) {
      try {
        await deps.sendSettleSpend(settleCommandFor(admission, now));
        settled++;
      } catch (error) {
        failed++;
        logger.warn(
          {
            gatewayRequestId: admission.gatewayRequestId,
            projectId: admission.tenantId,
            error,
          },
          "failed to settle an admission; the next sweep retries it",
        );
      }
    }

    reportSweep({
      settled,
      failed,
      found: open.length,
      graceMs,
      attempt: context.attempt,
    });
  };
}

/**
 * The settle command for one admission whose confirmation never arrived.
 *
 * Every attribution field is copied off the spend record rather than
 * re-resolved, so the settled record and the envelope it delivers name the
 * same organization and key the request was admitted against.
 */
function settleCommandFor(admission: OpenAdmission, now: number): SettleSpendCommandData {
  return {
    gateway_request_id: admission.gatewayRequestId,
    tenantId: admission.tenantId,
    occurred_at: now,
    reason: "confirmation_deadline_expired",
    organization_id: admission.organizationId,
    virtual_key_id: admission.virtualKeyId,
    principal_user_id: admission.principalUserId,
    // The fold has no TeamId column, so a sweep cannot know the team. The
    // debits process is the only reader of this field and never sees a
    // settled event, so nothing reads it here.
    team_id: "",
    end_user_id: admission.endUserId,
    trace_id: admission.traceId,
    request_type: admission.requestType,
    labels: admission.labels,
    metadata: admission.metadata,
    admitted_at: admission.admittedAtMs,
    // The identity the request asked for. Settlement resolved none of its
    // own, but the settled envelope has always named the requested one, and
    // the delivery process now reads what the outcome states rather than
    // remembering the admission.
    model: admission.model,
    model_provider_id: admission.providerKey,
  };
}

/**
 * What one sweep tells operators.
 *
 * A sweep that came back full did not finish: the rest waits for the next
 * interval, and a run of these means the population is growing faster than
 * one sweep drains it. The doc block on the cap promised this was reported;
 * it was not, so an operator would have seen a steady settled count and no
 * sign of the backlog behind it.
 */
function reportSweep({
  settled,
  failed,
  found,
  graceMs,
  attempt,
}: {
  settled: number;
  failed: number;
  found: number;
  graceMs: number;
  attempt: number;
}): void {
  const hitCap = found >= MAX_OPEN_ADMISSIONS_PER_SWEEP;
  const report = { settled, failed, graceMs, hitCap, attempt };
  if (failed > 0 || hitCap) {
    logger.warn(
      report,
      hitCap
        ? "settlement sweep hit its per-sweep cap; the remainder waits for the next sweep"
        : "settlement sweep could not settle every admission it found",
    );
    return;
  }
  logger.info(report, "settled admissions whose confirmation never arrived");
}
