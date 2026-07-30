import { createLogger } from "@langwatch/observability";
import { isTerminalDispatchError } from "../dispatchError";
import type { IntentContext, IntentHandler } from "./defineProcessManager";
import type { TriggerDispatchPorts } from "./triggerSettlement.dispatchPorts";
import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "./triggerSettlement.types";

const logger = createLogger("langwatch:automations:trigger-settlement");

/**
 * `triggerSettlement`'s three intent handlers — the effectful other half of
 * the pure `evolve`/`onWake` steps in `triggerSettlement.ts`. Each is a thin
 * control-flow adapter over `TriggerDispatchPorts`: confirm the match still
 * holds, check the at-most-once send claim, dispatch, claim. Retry doctrine:
 * a plain thrown error retries (the default — most failures here are
 * transient provider issues), `TerminalDispatchError` retires the message as
 * a logged drop.
 */

/** Records a bounded-state flush after the fact — never from pure `evolve`,
 *  which must stay a function of its inputs alone. The pending-match cap
 *  never discards a match, it dispatches the oldest ones ahead of their
 *  settle boundary; this just records how often that degraded batching
 *  kicks in. */
export function createLogOverflowHandler(): IntentHandler<LogOverflowIntent> {
  return async (payload, ctx) => {
    logger.warn(
      {
        tenantId: ctx.tenantId,
        triggerId: payload.triggerId,
        flushed: payload.flushed,
        totalFlushed: payload.totalFlushed,
      },
      "Trigger settlement pending-match bound flushed oldest matches to immediate dispatch",
    );
  };
}

async function confirmAndFilterCandidates(
  ports: TriggerDispatchPorts,
  params: { tenantId: string; triggerId: string; traceIds: readonly string[] },
): Promise<string[]> {
  const candidates: string[] = [];
  for (const traceId of new Set(params.traceIds)) {
    const outcome = await ports.confirmSettledMatch({
      tenantId: params.tenantId,
      triggerId: params.triggerId,
      traceId,
    });
    if (outcome === "trace-not-settled") {
      // Not "this match fails" — "we cannot yet tell". Throwing hands the
      // job back to the (future) outbox, which retries; silently dropping it
      // here would be indistinguishable from a real filter failure.
      throw new Error(
        `trace ${traceId} not settled yet for trigger ${params.triggerId} dispatch`,
      );
    }
    if (outcome === "filters-failed") continue; // "does not fire when its condition is unmet"
    if (
      await ports.isSendClaimed({
        tenantId: params.tenantId,
        triggerId: params.triggerId,
        traceId,
      })
    ) {
      continue; // "fires at most once per trace"
    }
    candidates.push(traceId);
  }
  return candidates;
}

async function claimAll(
  ports: TriggerDispatchPorts,
  params: { tenantId: string; triggerId: string; traceIds: readonly string[] },
): Promise<void> {
  // Best-effort, one at a time, never abandoned on a single failure: the
  // sends already happened, so a claim-write failure must not throw (that
  // would retry the whole intent and double-send every surviving trace).
  for (const traceId of params.traceIds) {
    try {
      await ports.claimSend({ tenantId: params.tenantId, triggerId: params.triggerId, traceId });
    } catch (error) {
      logger.warn(
        {
          tenantId: params.tenantId,
          triggerId: params.triggerId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "claimSend failed after a successful dispatch — swallowing to avoid a double-send on retry",
      );
    }
  }
}

/** `notifyDigest` handler: confirms + dedupes the batch's candidate traces,
 *  sends one digest for whatever survives, then claims each sent trace. */
export function createNotifyDigestHandler(
  ports: TriggerDispatchPorts,
): IntentHandler<NotifyDigestIntent> {
  return async (payload, ctx: IntentContext) => {
    const tenantId = ctx.tenantId;
    if (!(await ports.triggerIsActive({ tenantId, triggerId: payload.triggerId }))) {
      logger.info(
        { tenantId, triggerId: payload.triggerId },
        "Trigger gone or deactivated since match — dropping digest",
      );
      return;
    }

    const candidates = await confirmAndFilterCandidates(ports, {
      tenantId,
      triggerId: payload.triggerId,
      traceIds: payload.traceIds,
    });
    if (candidates.length === 0) {
      logger.debug(
        { tenantId, triggerId: payload.triggerId, batchSize: payload.traceIds.length },
        "Digest fully suppressed (filters / prior claims) — no dispatch",
      );
      return;
    }

    try {
      await ports.sendNotifyDigest({ tenantId, triggerId: payload.triggerId, traceIds: candidates });
    } catch (error) {
      if (isTerminalDispatchError(error)) {
        logger.info(
          { tenantId, triggerId: payload.triggerId, reason: error.message },
          "Notify digest dropped as terminal — not retried",
        );
        return;
      }
      logger.error(
        {
          tenantId,
          triggerId: payload.triggerId,
          attempt: ctx.attempt,
          error: error instanceof Error ? error.message : String(error),
        },
        "Notify digest dispatch failed — retrying",
      );
      throw error;
    }

    await claimAll(ports, { tenantId, triggerId: payload.triggerId, traceIds: candidates });
  };
}

/** `persistMatch` handler: one settled trace, confirmed and unclaimed, runs
 *  its persist action independently of every other pending match — batching
 *  a persist action would defeat "every match is the intent" (ADR-026). */
export function createPersistMatchHandler(
  ports: TriggerDispatchPorts,
): IntentHandler<PersistMatchIntent> {
  return async (payload, ctx: IntentContext) => {
    const tenantId = ctx.tenantId;
    if (!(await ports.triggerIsActive({ tenantId, triggerId: payload.triggerId }))) {
      logger.info(
        { tenantId, triggerId: payload.triggerId, traceId: payload.traceId },
        "Trigger gone or deactivated since match — dropping persist dispatch",
      );
      return;
    }
    if (
      await ports.isSendClaimed({ tenantId, triggerId: payload.triggerId, traceId: payload.traceId })
    ) {
      return;
    }

    const outcome = await ports.confirmSettledMatch({
      tenantId,
      triggerId: payload.triggerId,
      traceId: payload.traceId,
    });
    if (outcome === "trace-not-settled") {
      throw new Error(
        `trace ${payload.traceId} not settled yet for trigger ${payload.triggerId} persist dispatch`,
      );
    }
    if (outcome === "filters-failed") return;

    try {
      await ports.runPersistAction({ tenantId, triggerId: payload.triggerId, traceId: payload.traceId });
    } catch (error) {
      if (isTerminalDispatchError(error)) {
        logger.info(
          { tenantId, triggerId: payload.triggerId, traceId: payload.traceId, reason: error.message },
          "Persist dispatch dropped as terminal — not retried",
        );
        return;
      }
      logger.error(
        {
          tenantId,
          triggerId: payload.triggerId,
          traceId: payload.traceId,
          attempt: ctx.attempt,
          error: error instanceof Error ? error.message : String(error),
        },
        "Persist dispatch failed — retrying",
      );
      throw error;
    }

    await claimAll(ports, { tenantId, triggerId: payload.triggerId, traceIds: [payload.traceId] });
  };
}
