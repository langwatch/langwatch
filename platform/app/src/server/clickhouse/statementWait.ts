import { QueueFullError } from "@langwatch/clickhouse-client";
import type { createLogger } from "@langwatch/observability";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { toError } from "~/utils/posthogErrorCapture";

/**
 * One statement's wait bound, armed lazily at the limiter that first makes it
 * wait rather than up front.
 *
 * The saturation of a limiter can only be read truthfully at the instant the
 * statement enters it. A statement reaches the total from INSIDE its lane cap's
 * granted task, not up front, so at the moment it is handed to the lane cap the
 * total's occupancy is not yet the one it will face — the statement has not
 * entered the total, and will not until the cap grants. Arm up front and a
 * batch issued in one tick, each still only at its lane cap, reads a total no
 * statement has entered yet, so none of them would arm — then they queue on the
 * total with no bound at all. So this object carries the timer, and `acquire`
 * calls {@link StatementWait.armIfSaturated} right before each `run`, when that
 * limiter's own count is current.
 *
 * Arming is idempotent: one timer bounds the whole statement, lane cap wait and
 * total wait alike, so the first saturated limiter starts it and a later one
 * reuses it. The timer, once armed, is disposed at admission.
 *
 * A plain timer rather than `AbortSignal.timeout` for two reasons: it can be
 * CLEARED the moment the statement is admitted, where a timeout signal holds
 * its timer for the full duration regardless, and a saturated limiter would
 * accumulate one per queued statement; and it is fakeable, so the test for this
 * does not have to spend twenty real seconds proving it.
 */
export interface StatementWait {
  /** Arm the one timer (idempotently) when the limiter being entered is full. */
  armIfSaturated: (isFull: boolean) => void;
  /**
   * The signal to hand the limiter. The caller's signal until armed, so the
   * ordinary unsaturated path allocates neither a timer nor an `AbortSignal.any`
   * — millions of statements a day that never wait. Composed with our abort
   * controller once armed, and read fresh at each `run` so a timer armed only
   * at the total still bounds the total wait.
   */
  readonly signal: AbortSignal | undefined;
  /** True only if OUR timer fired — never merely that the signal aborted. */
  hasTimedOut: () => boolean;
  dispose: () => void;
}

export function createStatementWait({
  signal,
  waitTimeoutMs,
}: {
  signal: AbortSignal | undefined;
  waitTimeoutMs: number;
}): StatementWait {
  let composed: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hasFired = false;

  const arm = () => {
    if (timer) return;
    const controller = new AbortController();
    composed = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    timer = setTimeout(() => {
      hasFired = true;
      controller.abort();
    }, waitTimeoutMs);
    // Never a reason to hold the process open: if nothing else is running there
    // is no statement ahead of this one to wait for.
    timer.unref?.();
  };

  return {
    armIfSaturated: (isFull) => {
      if (isFull) arm();
    },
    get signal() {
      return composed ?? signal;
    },
    hasTimedOut: () => hasFired,
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * The transient error a refused statement should surface, or `undefined` to
 * rethrow the original. Only a refusal is translated: once admitted, the
 * statement's own errors belong to the layers below, and translating them here
 * would relabel a memory limit or a syntax error as overload.
 *
 * A full queue and a wait that ran out are the same verdict: no capacity for
 * this statement. `hasTimedOut` must be OUR timer firing, never the aborted-ness
 * of the composed signal, so a caller cancelling its own request keeps
 * surfacing as the cancellation it is.
 */
export function statementRefusal({
  error,
  isAdmitted,
  hasTimedOut,
  queuedAt,
  waitTimeoutMs,
  logger,
  subject,
  logFields,
  onShed,
}: {
  error: unknown;
  isAdmitted: boolean;
  hasTimedOut: boolean;
  queuedAt: number;
  waitTimeoutMs: number;
  logger: ReturnType<typeof createLogger>;
  /** What was refused, for the log line, e.g. "a ClickHouse statement". */
  subject: string;
  logFields: Record<string, unknown>;
  onShed?: () => void;
}): ClickHouseOverloadedError | undefined {
  if (isAdmitted) return undefined;

  if (error instanceof QueueFullError) {
    onShed?.();
    logger.warn(
      { ...logFields, maxQueued: error.maxQueued },
      `Refused ${subject}: concurrency wait queue full`,
    );
    return new ClickHouseOverloadedError({ reasons: [toError(error)] });
  }

  if (hasTimedOut) {
    onShed?.();
    logger.warn(
      {
        ...logFields,
        waitedMs: Math.round(performance.now() - queuedAt),
        timeoutMs: waitTimeoutMs,
      },
      `Refused ${subject}: waited too long for a slot`,
    );
    return new ClickHouseOverloadedError({ reasons: [toError(error)] });
  }

  return undefined;
}
