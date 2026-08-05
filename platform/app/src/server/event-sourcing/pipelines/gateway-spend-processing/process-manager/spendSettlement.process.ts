import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type {
  AdmitSpendCommandData,
  SettleSpendCommandData,
} from "../schemas/commands";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "../schemas/constants";
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
  /** Admission instant (event time), 0 until the admitted event is seen. */
  admittedAtMs: number;
  /** A confirmation, failure, or settlement closed this request. */
  resolved: boolean;
  /** The sweeper already issued settleSpend; wakes stand down. */
  settleIssued: boolean;
}

export const INITIAL_SPEND_SETTLEMENT_STATE: SpendSettlementState = {
  admittedAtMs: 0,
  resolved: false,
  settleIssued: false,
};

export interface SpendSettlementProcessDeps {
  /** Sends the settleSpend command into this pipeline. Injected lazily so
   *  the process manager can be registered while the pipeline is built. */
  sendSettleSpend: (data: SettleSpendCommandData) => Promise<void>;
  /** Grace override for tests; production reads the env-backed constant. */
  graceMs?: number;
  now?: () => number;
}

const settleSchema = z.object({
  gateway_request_id: z.string().min(1),
  project_id: z.string().min(1),
});

function runSettle(deps: SpendSettlementProcessDeps) {
  return async (
    payload: z.output<typeof settleSchema>,
    context: IntentContext,
  ): Promise<void> => {
    await deps.sendSettleSpend({
      gateway_request_id: payload.gateway_request_id,
      tenantId: payload.project_id,
      occurred_at: (deps.now ?? Date.now)(),
      reason: "confirmation_deadline_expired",
    });
    logger.info(
      {
        gatewayRequestId: payload.gateway_request_id,
        projectId: payload.project_id,
        attempt: context.attempt,
      },
      "settled an admission whose confirmation never arrived",
    );
  };
}

/**
 * The M2 settlement sweeper: every admission arms a wake at
 * admission + grace, and an outcome (confirmed, failed, or an
 * already-settled replay) stands the wake down. A wake that fires with
 * no outcome seen issues settleSpend, which the fold records as
 * status=settled with unknown (null, never zero) quantities and
 * needs_reconciliation=true, and the delivery process manager emits the
 * `gateway.request.settled` envelope. A confirmation arriving after
 * settlement still resolves: the fold's supersession table replaces the
 * settled record and the superseding completed envelope delivers.
 *
 * Instances are keyed by the aggregate id (the gateway request), so the
 * process key IS the request id. The command is idempotent by
 * (tenant, request, step), so a duplicate wake or an ops replay of the
 * settle intent cannot double-settle.
 */
export function spendSettlementPM(
  deps: SpendSettlementProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> {
  const grace = deps.graceMs ?? settlementGraceMs();
  return (pm) =>
    pm
      .state<SpendSettlementState>(INITIAL_SPEND_SETTLEMENT_STATE)
      .intent("settle", settleSchema, runSettle(deps))
      .on(GATEWAY_SPEND_ADMITTED_EVENT_TYPE, (state, data, ctx) => {
        const admitted = data as AdmitSpendCommandData;
        if (state.resolved) {
          // The outcome raced ahead of its admission; nothing to watch.
          return {
            state: { ...state, admittedAtMs: admitted.occurred_at },
          };
        }
        return {
          state: { ...state, admittedAtMs: admitted.occurred_at },
          // Schedule from max(admission + grace, now): a backlogged
          // admission whose grace already elapsed wakes immediately
          // instead of writing a wake into the past.
          nextWakeAt: Math.max(admitted.occurred_at + grace, ctx.now),
        };
      })
      .on(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, (state) => ({
        state: { ...state, resolved: true },
        nextWakeAt: null,
      }))
      .on(GATEWAY_SPEND_FAILED_EVENT_TYPE, (state) => ({
        state: { ...state, resolved: true },
        nextWakeAt: null,
      }))
      .on(GATEWAY_SPEND_SETTLED_EVENT_TYPE, (state) => ({
        // Whether this sweeper's own settle or an operator's, the request
        // is closed and any pending wake stands down.
        state: { ...state, resolved: true, settleIssued: true },
        nextWakeAt: null,
      }))
      .onWake((state, ctx) => {
        if (state.resolved || state.settleIssued) return { state };
        return {
          state: { ...state, settleIssued: true },
          intents: [
            ctx.intents.settle(`settle:${ctx.key}`, {
              gateway_request_id: ctx.key,
              project_id: ctx.projectId,
            }),
          ],
        };
      });
}
