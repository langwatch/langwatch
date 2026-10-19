import type { IntentContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import type { OpenAdmission } from "../repositories/gateway-open-admissions.repository.ts";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../rules/gateway-spend-settlement.rules.ts";
import type { SettleSpendCommandData } from "./gateway-spend-commands.process.ts";

const logger = createLogger("langwatch:gateway-spend:settlement");

/**
 * How long an admission may sit unconfirmed before the sweeper settles it as
 * cost-unknown. Sized for the SLOWEST legitimate request, not the median;
 * settling early is recoverable since a late confirmation supersedes it.
 */
export const SETTLEMENT_GRACE_MS_DEFAULT = 30 * 60 * 1000;

/**
 * How far back a sweep looks. `OccurredAt` is the spend table's partition
 * key, so this bound keeps the scan off the full 13-month (cold-storage)
 * retention; seven days is past any grace an operator can configure.
 */
export const SETTLEMENT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Operator override, epoch-milliseconds, bounded below so a typo cannot turn
 * every in-flight request into a settlement storm. Parsed here once so the
 * REST policy and the sweeper cannot disagree about what was asked for.
 */
export function settlementGraceMs(raw: string | undefined): number {
  if (!raw) return SETTLEMENT_GRACE_MS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    logger.warn({ raw }, "ignoring invalid LW_SPEND_SETTLEMENT_GRACE_MS; using the default");
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
 * Settles every admission past its grace, best-effort per row: one tenant's
 * failed send must not cost the rest of the sweep. A row that fails stays
 * open and is retried on the next sweep, which is what the sweep is for.
 */
export function runSpendSettlementSweep(
  deps: SpendSettlementProcessDeps,
): (payload: { scheduledFor: number }, context: IntentContext) => Promise<void> {
  return async (_payload: { scheduledFor: number }, context: IntentContext): Promise<void> => {
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
 * The settle command for an admission whose confirmation never arrived.
 * Every attribution field is copied off the spend record rather than
 * re-resolved, so it names the same org and key the request was admitted against.
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
 * What one sweep tells operators. A sweep that came back full did not
 * finish — the rest waits for the next interval — and a run of these means
 * the population is growing faster than one sweep drains it.
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
