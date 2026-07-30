import type { IntentDef } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";

import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";

import type {
  IngestionPullRunCompletedData,
  IngestionPullRunFailedData,
} from "../schemas/events";
import { ingestionPullRunIntentSchema } from "./ingestionPullProcess.types";

const logger = createLogger("langwatch:governance:ingestion-pull-effects");

export interface IngestionPullRunPort {
  run(params: {
    sourceId: string;
    cursor: string | null;
  }): Promise<{ nextCursor: string | null; eventCount: number }>;
}

/** The pipeline commands the effect reports its outcome through. Resolved by
 * name at send time, so this pipeline can name its own commands before the
 * registry has them. */
export interface IngestionPullOutcomeCommands {
  recordRunCompleted(
    input: IngestionPullRunCompletedData,
    ctx: { readonly tenantId: string },
  ): Promise<unknown>;
  recordRunFailed(
    input: IngestionPullRunFailedData,
    ctx: { readonly tenantId: string },
  ): Promise<unknown>;
}

export interface IngestionPullDispatchDeps {
  runPort: IngestionPullRunPort;
  commands: IngestionPullOutcomeCommands;
  clock?: () => number;
}

/**
 * The `run` intent: one pull attempt per delivery, from the durable cursor the
 * payload carries.
 *
 * At-least-once + idempotent: a redelivered intent re-pulls from the same
 * durable cursor, and its outcome commands are content-hashed by the command
 * boundary, so it cannot double-record.
 *
 * A provider failure records `run_failed` and settles rather than rethrowing.
 * Rethrowing would re-lease the row on a schedule the shared outbox worker
 * owns, and never record the failure at all — so the run's error would never
 * reach `ConsecutiveErrors` and the source would look healthy while pulling
 * nothing. The next cron wake starts a fresh run from the same cursor.
 */
export function ingestionPullIntents(deps: IngestionPullDispatchDeps) {
  const clock = deps.clock ?? (() => Date.now());
  return {
    run: {
      payload: ingestionPullRunIntentSchema,
      messageKey: (payload) => `pull:${payload.sourceId}:${payload.runId}`,
      async deliver(payload, ctx) {
        const pullStartedAtMs = clock();
        let result: Awaited<ReturnType<IngestionPullRunPort["run"]>>;
        try {
          result = await deps.runPort.run({
            sourceId: payload.sourceId,
            cursor: payload.cursor,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          // The alertable outcome (ADR-054): the pull did not land and a
          // run_failed is recorded for it.
          incrementIngestionPullTotal({ outcome: "failed_final" });
          logger.warn(
            { sourceId: payload.sourceId, runId: payload.runId, error: detail },
            "Ingestion pull failed; the next scheduled run retries from the durable cursor",
          );
          await deps.commands.recordRunFailed(
            {
              occurredAt: clock(),
              sourceId: payload.sourceId,
              runId: payload.runId,
              scheduledFor: payload.scheduledFor,
              error: detail,
              errorCode: "pull_failed",
              // Nothing retries THIS run — the next scheduled wake starts a
              // fresh one from the durable cursor.
              retryable: false,
            },
            { tenantId: ctx.tenantId },
          );
          return;
        }
        incrementIngestionPullTotal({ outcome: "completed" });
        observeIngestionPullDuration({ durationMs: clock() - pullStartedAtMs });
        // Kept outside the catch above: if this write fails the outbox
        // redelivers the idempotent intent, and it must never turn a
        // successful pull into a run_failed event.
        await deps.commands.recordRunCompleted(
          {
            occurredAt: clock(),
            sourceId: payload.sourceId,
            runId: payload.runId,
            scheduledFor: payload.scheduledFor,
            ...result,
          },
          { tenantId: ctx.tenantId },
        );
      },
    } satisfies IntentDef<typeof ingestionPullRunIntentSchema>,
  };
}

export type IngestionPullIntents = ReturnType<typeof ingestionPullIntents>;
