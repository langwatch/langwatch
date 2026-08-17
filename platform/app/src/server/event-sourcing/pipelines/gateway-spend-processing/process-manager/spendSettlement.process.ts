import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  IntentContext,
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
// TYPE-only, deliberately. A value import from the repository pulls the
// ClickHouse client into this module's graph, and this module is reached from
// the pipeline registry that several suites mock — which turns a
// `vi.mock` factory into a hoisting failure. Nothing here needs the
// repository at runtime: the sweep's bounds arrive as deps.
import type { OpenAdmission } from "../repositories/openAdmissions.clickhouse.repository";
import type { SettleSpendCommandData } from "../schemas/commands";
import type { GatewaySpendProcessingEvent } from "../schemas/events";

const logger = createLogger("langwatch:gateway-spend:settlement");

export const SPEND_SETTLEMENT_PROCESS_NAME = "spendSettlement" as const;

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
 * How often the sweeper looks. Settlement latency is grace + at most one
 * interval, so five minutes is a rounding error against a thirty-minute
 * grace while keeping each sweep's scan small.
 */
export const SETTLEMENT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

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

/** Operator override, epoch-milliseconds. Bounded below so a typo cannot
 *  turn every in-flight request into a settlement storm. */
export function settlementGraceMs(): number {
  const raw = process.env.LW_SPEND_SETTLEMENT_GRACE_MS;
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

export interface SpendSettlementState {
  /** Epoch ms of the last sweep this process scheduled, for operators. */
  lastSweepAt: number | null;
}

export const INITIAL_SPEND_SETTLEMENT_STATE: SpendSettlementState = {
  lastSweepAt: null,
};

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
  /** Grace override for tests; production reads the env-backed constant. */
  graceMs?: number;
  lookbackMs?: number;
  now?: () => number;
}

const sweepSchema = z.object({
  scheduledFor: z.number().int(),
});

type SpendSettlementIntents = {
  sweep: IntentSpec<typeof sweepSchema>;
};

/**
 * Arms the next sweep and hands the work to the outbox.
 *
 * Declared out here with an explicit intents type rather than inline in the
 * applier, the same way every other scheduled process does it: the builder
 * infers a wake handler's intents from the handler itself, so an inline one
 * types `ctx.intents.sweep` as possibly-undefined and cannot be called.
 *
 * Wake handlers must be pure and synchronous — the commit that persists this
 * evolution is what fences racing workers — so the query and the sends run
 * behind the outbox lease as an intent instead.
 */
export const spendSettlementWake: WakeHandler<
  SpendSettlementState,
  SpendSettlementIntents
> = (state, ctx) => ({
  state: { ...state, lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/**
 * Settles every admission past its grace.
 *
 * Best-effort per row: one tenant's failed send must not cost the rest of
 * the sweep, because the next wake would find the same backlog plus another
 * interval of it. A row that fails is left open and retried on the next
 * sweep, which is exactly what the sweep is for.
 */
function runSweep(deps: SpendSettlementProcessDeps) {
  return async (
    _payload: z.output<typeof sweepSchema>,
    context: IntentContext,
  ): Promise<void> => {
    const now = (deps.now ?? Date.now)();
    const graceMs = deps.graceMs ?? settlementGraceMs();
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
        await deps.sendSettleSpend({
          gateway_request_id: admission.gatewayRequestId,
          tenantId: admission.tenantId,
          occurred_at: now,
          reason: "confirmation_deadline_expired",
          // The fold recorded this at admission, so the settled record and
          // the envelope it delivers name the same organization and key the
          // request was admitted against.
          organization_id: admission.organizationId,
          virtual_key_id: admission.virtualKeyId,
          principal_user_id: admission.principalUserId,
          team_id: "",
          end_user_id: admission.endUserId,
          trace_id: admission.traceId,
          request_type: admission.requestType,
          labels: admission.labels,
          metadata: admission.metadata,
          admitted_at: admission.admittedAtMs,
        });
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

    logger.info(
      { settled, failed, graceMs, attempt: context.attempt },
      "settled admissions whose confirmation never arrived",
    );
  };
}

/**
 * The settlement sweeper: ONE process instance for the whole install, woken
 * on a schedule, asking the spend record which admissions are still open
 * past their grace and settling each one.
 *
 * It used to be one instance per gateway request, each holding a durable row
 * and a wake armed at admission + grace. That is the right shape for a
 * long-lived entity and the wrong one for a request: the aggregate is
 * per-request, so the framework keyed an instance per request, and
 * `ProcessManagerInstance` has no retention sweep because it is documented as
 * bounded by entity population rather than by traffic. A timer per LLM call
 * made that false.
 *
 * The join those rows existed to perform is already done: the fold writes one
 * `gateway_spend` row per request and leaves it at `admitted` until an
 * outcome arrives, so "which requests are still open" is a query, not a
 * memory. Settlement latency becomes grace + at most one sweep interval, and
 * the settle command is idempotent by (tenant, request, step), so a
 * re-settled row is a no-op rather than a double charge.
 */
export function spendSettlementPM(
  deps: SpendSettlementProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> {
  return (pm) =>
    pm
      .state<SpendSettlementState>(INITIAL_SPEND_SETTLEMENT_STATE)
      .schedule({ everyMs: SETTLEMENT_SWEEP_INTERVAL_MS })
      .onWake(spendSettlementWake)
      .intent("sweep", sweepSchema, runSweep(deps))
      .outbox({
        maxAttempts: 3,
        concurrency: 1,
        batchSize: 1,
        // One sweep can settle thousands of rows, each a command append.
        leaseDurationMs: 10 * 60 * 1000,
      });
}
