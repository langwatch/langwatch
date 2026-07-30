import { createLogger } from "@langwatch/observability";

import type { IntentExecutor } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import type { ResolveOriginCommandData } from "../schemas/commands";
import {
  ORIGIN_GATE_FALLBACK_ORIGIN,
  ORIGIN_GATE_FALLBACK_REASON,
  type OriginGateResolveIntent,
} from "./originGateProcess.types";

const logger = createLogger(
  "langwatch:trace-processing:origin-gate-process",
);

/** What the fallback write needs from the trace domain. */
export interface OriginGateDispatchDeps {
  /**
   * Dispatches the `resolveOrigin` command. Idempotent twice over: the
   * command carries a deterministic idempotency key per (tenant, trace), and
   * the trace-summary fold refuses to override an origin it already has — so
   * a retried dispatch cannot produce a second origin or overwrite a real one.
   */
  resolveOrigin: (data: ResolveOriginCommandData) => Promise<void>;
}

/**
 * Executes the `resolveOrigin` intent: records that a trace which never said
 * where it came from is an ordinary application trace.
 *
 * Throwing is the right response to an infrastructure fault — the outbox
 * retries, and the alternative is a trace that stays un-attributed, which is
 * the gap this process exists to close. The dispatch is idempotent, so the
 * retry costs nothing.
 *
 * `occurredAt` is stamped at dispatch rather than carried on the intent: the
 * event records when the fallback was decided, and a message that sat in the
 * outbox through a retry should not claim to have happened at its first
 * attempt.
 */
export function createOriginGateResolveHandler(
  deps: OriginGateDispatchDeps,
): IntentExecutor<OriginGateResolveIntent> {
  return async (payload) => {
    logger.debug(
      { tenantId: payload.tenantId, traceId: payload.traceId },
      "Origin grace period elapsed — writing the fallback origin",
    );

    await deps.resolveOrigin({
      tenantId: payload.tenantId,
      traceId: payload.traceId,
      origin: ORIGIN_GATE_FALLBACK_ORIGIN,
      reason: ORIGIN_GATE_FALLBACK_REASON,
      occurredAt: Date.now(),
    });
  };
}
