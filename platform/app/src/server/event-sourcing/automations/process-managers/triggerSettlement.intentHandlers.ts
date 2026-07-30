import { createLogger } from "@langwatch/observability";
import {
  type IntentContext,
  type IntentHandler,
  isTerminalDispatchError,
} from "../intentDispatch";
import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "./triggerSettlement";

const logger = createLogger("langwatch:automations:trigger-settlement");

type WithTenant<T> = T & { readonly tenantId: string };

/**
 * What `triggerSettlement`'s handlers call out to: one port per QUESTION the
 * control flow needs answered, not one per channel. Provider selection,
 * templates, caps and suppression live behind `sendNotifyDigest` /
 * `runPersistAction`, in `app-layer/automations/*` — reaching into those from
 * here is the sideways coupling ADR-102 decision 5 rules out.
 *
 * Every parameter shape is `Pick`ed from the intent payloads declared in
 * `triggerSettlement.ts`, so a payload change lands here rather than drifting.
 */
export interface TriggerDispatchPorts {
  /** A trigger deleted or deactivated after its match was recorded drops its
   *  pending dispatch rather than failing. */
  triggerIsActive(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId">>,
  ): Promise<boolean>;

  /**
   * Re-confirms a settled match still satisfies the trigger's conditions at
   * dispatch time. Three outcomes because "we cannot tell yet" and "we know it
   * fails" need opposite handling: `"trace-not-settled"` is a retryable gap in
   * the trace fold, `"filters-failed"` is a terminal, silent drop.
   */
  confirmSettledMatch(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<"confirmed" | "trace-not-settled" | "filters-failed">;

  /** At-most-once gate independent of the outbox's own dedup: the outbox
   *  collapses a RETRY of one intent, this collapses two DIFFERENT intents
   *  (two settle rounds for one trace) that would otherwise both fire. */
  isSendClaimed(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<boolean>;

  /** Written AFTER a successful send — writing it first would make a retry of
   *  a failed send silently no-op. */
  claimSend(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<void>;

  /** Throws `TerminalDispatchError` for an outcome that must not retry;
   *  anything else thrown retries on the outbox's budget. */
  sendNotifyDigest(
    params: WithTenant<Pick<NotifyDigestIntent, "triggerId" | "traceIds">>,
  ): Promise<void>;

  /** Runs the persist-class action for one confirmed, unclaimed trace. Same
   *  retry contract as `sendNotifyDigest`. */
  runPersistAction(
    params: WithTenant<Pick<PersistMatchIntent, "triggerId" | "traceId">>,
  ): Promise<void>;
}

/** Records a bounded-state flush after the fact — never from the pure step,
 *  which must stay a function of its inputs alone. */
export function createLogOverflowHandler(): IntentHandler<LogOverflowIntent> {
  return async (payload, ctx) => {
    logger.warn(
      {
        tenantId: ctx.tenantId,
        triggerId: payload.triggerId,
        flushed: payload.traceIds.length,
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
      // Not "this match fails" — "we cannot yet tell". Throwing hands the job
      // back to the outbox; dropping it here is indistinguishable from a real
      // filter failure.
      throw new Error(
        `trace ${traceId} not settled yet for trigger ${params.triggerId} dispatch`,
      );
    }
    if (outcome === "filters-failed") continue;
    if (
      await ports.isSendClaimed({
        tenantId: params.tenantId,
        triggerId: params.triggerId,
        traceId,
      })
    ) {
      continue;
    }
    candidates.push(traceId);
  }
  return candidates;
}

async function claimAll(
  ports: TriggerDispatchPorts,
  params: { tenantId: string; triggerId: string; traceIds: readonly string[] },
): Promise<void> {
  // Best-effort: the sends already happened, so a claim-write failure must not
  // throw — that would retry the whole intent and double-send every surviving
  // trace.
  for (const traceId of params.traceIds) {
    try {
      await ports.claimSend({
        tenantId: params.tenantId,
        triggerId: params.triggerId,
        traceId,
      });
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

export function createNotifyDigestHandler(
  ports: TriggerDispatchPorts,
): IntentHandler<NotifyDigestIntent> {
  return async (payload, ctx: IntentContext) => {
    const tenantId = ctx.tenantId;
    if (
      !(await ports.triggerIsActive({ tenantId, triggerId: payload.triggerId }))
    ) {
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
        {
          tenantId,
          triggerId: payload.triggerId,
          batchSize: payload.traceIds.length,
        },
        "Digest fully suppressed (filters / prior claims) — no dispatch",
      );
      return;
    }

    try {
      await ports.sendNotifyDigest({
        tenantId,
        triggerId: payload.triggerId,
        traceIds: candidates,
      });
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

    await claimAll(ports, {
      tenantId,
      triggerId: payload.triggerId,
      traceIds: candidates,
    });
  };
}

/** One settled trace runs its persist action independently of every other
 *  pending match — batching would defeat "every match is the intent"
 *  (ADR-026). */
export function createPersistMatchHandler(
  ports: TriggerDispatchPorts,
): IntentHandler<PersistMatchIntent> {
  return async (payload, ctx: IntentContext) => {
    const tenantId = ctx.tenantId;
    if (
      !(await ports.triggerIsActive({ tenantId, triggerId: payload.triggerId }))
    ) {
      logger.info(
        {
          tenantId,
          triggerId: payload.triggerId,
          traceId: payload.traceId,
        },
        "Trigger gone or deactivated since match — dropping persist dispatch",
      );
      return;
    }
    if (
      await ports.isSendClaimed({
        tenantId,
        triggerId: payload.triggerId,
        traceId: payload.traceId,
      })
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
      await ports.runPersistAction({
        tenantId,
        triggerId: payload.triggerId,
        traceId: payload.traceId,
      });
    } catch (error) {
      if (isTerminalDispatchError(error)) {
        logger.info(
          {
            tenantId,
            triggerId: payload.triggerId,
            traceId: payload.traceId,
            reason: error.message,
          },
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

    await claimAll(ports, {
      tenantId,
      triggerId: payload.triggerId,
      traceIds: [payload.traceId],
    });
  };
}
