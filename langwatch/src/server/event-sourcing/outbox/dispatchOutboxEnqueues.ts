import { DEFAULT_TRACE_DEBOUNCE_MS } from "~/automations/cadences";
import type { Logger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { OutboxEnqueueRequest } from "./outboxReactor.types";
import {
  type GraphEvalStagePayload,
  isGraphEval,
  isSettle,
  type SettleStagePayload,
} from "./payload";
import type { OutboxRuntime } from "./setup";

/**
 * Shared dispatch loop used by every SOURCE of outbox enqueue requests:
 *
 *   1. `adaptOutboxReactor` — events flowing through a `.withOutbox`
 *      reactor decide what to enqueue per event.
 *   2. `OutboxHeartbeatScheduler` — periodic ticks decide what to
 *      enqueue when the event-driven path structurally can't react
 *      (no-data detection, resolve-when-traffic-stops).
 *
 * Both feed the SAME `outbox.enqueueSettle` path, so dedup, retry
 * semantics, and audit projection stay identical regardless of what
 * woke the dispatch up.
 *
 * Behaviour:
 *   - Empty `requests` is a no-op.
 *   - Non-settle payloads are skipped + reported (the GroupQueue-routed
 *     adapter only forwards settle payloads to `enqueueSettle`).
 *   - A failed `enqueueSettle` for one request is logged + captured
 *     and the loop continues with the next request — one bad row
 *     never poisons the rest of the batch.
 *
 * `sourceName` is the operator-facing identifier of the SOURCE (reactor
 * name OR heartbeat name) so log lines and Sentry breadcrumbs make
 * sense.
 */
export async function dispatchOutboxEnqueues({
  requests,
  outbox,
  sourceName,
  logger,
}: {
  requests: OutboxEnqueueRequest[];
  outbox: OutboxRuntime;
  sourceName: string;
  logger: Logger;
}): Promise<void> {
  if (requests.length === 0) return;

  for (const request of requests) {
    // `OutboxPayload` is `Prisma.InputJsonValue` (recursive JSON);
    // narrow it back into the structural object shape the `isXxx`
    // discriminators expect.
    const payload = request.payload as Record<string, unknown>;
    if (isSettlePayload(payload)) {
      await dispatchSettle({
        outbox,
        request,
        payload,
        sourceName,
        logger,
      });
      continue;
    }
    if (isGraphEvalPayload(payload)) {
      await dispatchGraphEval({
        outbox,
        request,
        payload,
        sourceName,
        logger,
      });
      continue;
    }
    const error = new Error(
      `Outbox source "${sourceName}" emitted an unsupported payload (stage="${
        (payload as { stage?: unknown }).stage ?? "<missing>"
      }"); only settle and graphEval payloads are routed.`,
    );
    logger.error({ sourceName, dedupKey: request.dedupKey }, error.message);
    captureException(error, {
      extra: { sourceName, dedupKey: request.dedupKey },
    });
  }
}

async function dispatchSettle({
  outbox,
  request,
  payload,
  sourceName,
  logger,
}: {
  outbox: OutboxRuntime;
  request: OutboxEnqueueRequest;
  payload: SettleStagePayload;
  sourceName: string;
  logger: Logger;
}): Promise<void> {
  try {
    await outbox.enqueueSettle(payload, {
      ttlMs: request.enqueueOptions?.ttlMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
    });
  } catch (error) {
    logger.error(
      {
        sourceName,
        dedupKey: request.dedupKey,
        error: error instanceof Error ? error.message : String(error),
      },
      "Outbox enqueueSettle failed",
    );
    captureException(toError(error), {
      extra: { sourceName, dedupKey: request.dedupKey },
    });
  }
}

async function dispatchGraphEval({
  outbox,
  request,
  payload,
  sourceName,
  logger,
}: {
  outbox: OutboxRuntime;
  request: OutboxEnqueueRequest;
  payload: GraphEvalStagePayload;
  sourceName: string;
  logger: Logger;
}): Promise<void> {
  try {
    await outbox.enqueueGraphEval(payload, {
      ttlMs: request.enqueueOptions?.ttlMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      makeDedupId: request.dedupKey,
    });
  } catch (error) {
    logger.error(
      {
        sourceName,
        dedupKey: request.dedupKey,
        error: error instanceof Error ? error.message : String(error),
      },
      "Outbox enqueueGraphEval failed",
    );
    captureException(toError(error), {
      extra: { sourceName, dedupKey: request.dedupKey },
    });
  }
}

function isSettlePayload(
  payload: Record<string, unknown>,
): payload is SettleStagePayload {
  return isSettle(payload);
}

function isGraphEvalPayload(
  payload: Record<string, unknown>,
): payload is GraphEvalStagePayload {
  return isGraphEval(payload);
}
