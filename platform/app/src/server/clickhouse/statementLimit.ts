import type { ClickHouseClient } from "@clickhouse/client";
import { ConcurrencyLimiter, QueueFullError } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { toError } from "~/utils/posthogErrorCapture";
import {
  incrementClickHouseStatementsShed,
  observeClickHouseStatementWait,
  registerClickHouseLimiter,
} from "./metrics";

const logger = createLogger("langwatch:clickhouse:statement-limit");

/**
 * How many statements may wait per slot before the process starts refusing.
 *
 * A wait queue is not an alternative to a bound, it is how a bound stays usable
 * under a burst: work that arrives while the slots are full waits a moment
 * instead of failing. What it must not be is unbounded, because then overload
 * stops being visible - the server stays inside its limit while the wait grows
 * without end and latency climbs until something upstream times out.
 *
 * Eight is deliberately generous. Shedding is a behaviour change, and the point
 * of this first pass is to make waiting measurable, not to start refusing work
 * that used to succeed. Tighten it once `clickhouse_statement_wait_seconds`
 * says what the real waits look like.
 */
export const QUEUE_DEPTH_PER_SLOT = 8;

/** Never so shallow that a small pool sheds on ordinary burstiness. */
export const MIN_QUEUE_DEPTH = 64;

/**
 * The longest a statement may wait for a slot before it is refused.
 *
 * The queue was bounded by DEPTH but not by TIME, so a caller could sit in it
 * for as long as the statements ahead took — and then still spend the driver's
 * full `request_timeout` on the wire. That is how a 46-second failure was
 * assembled out of two limits, neither of which was 46 seconds.
 *
 * Shorter than the request timeout on purpose: a queued statement has done no
 * work, so abandoning it costs nothing, while one already on the wire may be
 * about to succeed. Refusal is also not loss — it raises
 * `ClickHouseOverloadedError`, which classifies as transient, so a read retries
 * and a job is re-staged by the queue. Waiting a further twenty seconds for a
 * slot that arrives with no time left to use it serves nobody.
 */
export const STATEMENT_WAIT_TIMEOUT_MS = 20_000;

type LimitedOperation = "query" | "insert" | "command" | "exec";

/**
 * The subset of a statement's parameters this layer reads. Every ClickHouse
 * driver method takes an options object that may carry an abort signal; nothing
 * else here is inspected.
 */
interface StatementParams {
  abort_signal?: AbortSignal;
}

function signalOf(params: unknown): AbortSignal | undefined {
  if (!params || typeof params !== "object") return undefined;
  return (params as StatementParams).abort_signal;
}

/**
 * Bounds the statements a process will try to run against one ClickHouse
 * instance, and reports the bound.
 *
 * Compose this OUTSIDE retry. The resilient client retries inside its own
 * `query`, so wrapping that client holds one slot for the whole statement,
 * retries included. The other order - a slot per attempt - is how a small
 * overload becomes a persistent one: a retrying statement releases its slot,
 * joins the back of the queue behind work that arrived later, and takes longer
 * to finish the more loaded the system gets.
 *
 * The limit is the pool size, so this changes no capacity on the day it lands.
 * What changes is where the queueing happens: in a queue that is finite, timed
 * and counted, rather than inside the connection pool where it had no timeout,
 * no metric and no ceiling.
 */
export function withStatementLimit<T extends ClickHouseClient>({
  client,
  maxConcurrent,
  instance,
  waitTimeoutMs = STATEMENT_WAIT_TIMEOUT_MS,
}: {
  client: T;
  maxConcurrent: number;
  instance: string;
  /** Overridable so a test can prove the bound without spending it. */
  waitTimeoutMs?: number;
}): T {
  const maxQueued = Math.max(MIN_QUEUE_DEPTH, maxConcurrent * QUEUE_DEPTH_PER_SLOT);
  const limiter = new ConcurrencyLimiter({ maxConcurrent, maxQueued });

  registerClickHouseLimiter(instance, () => limiter.stats());

  logger.info(
    { instance, maxConcurrent, maxQueued },
    "ClickHouse statement concurrency bounded",
  );

  const limited = Object.create(client) as T;

  for (const operation of ["query", "insert", "command", "exec"] as LimitedOperation[]) {
    const inner = client[operation];
    // A driver that does not expose one of these is not an error worth
    // failing a boot over - leave the property alone and let the prototype
    // chain answer for it.
    if (typeof inner !== "function") continue;

    (limited as Record<string, unknown>)[operation] = (params: unknown) =>
      run({
        limiter,
        maxConcurrent,
        instance,
        operation,
        signal: signalOf(params),
        waitTimeoutMs,
        task: () => (inner as (p: unknown) => Promise<unknown>).call(client, params),
      });
  }

  // `close` and `ping` are not statements, so they are not limited - but they
  // must still run against the real client. The facade is an Object.create
  // over it and the default-settings proxy forwards with `receiver`, so
  // without this they would execute with `this` bound to the facade, and a
  // driver that uses `this` for teardown would break on the cleanup path.
  for (const passthrough of ["close", "ping"] as const) {
    const inner = client[passthrough];
    if (typeof inner !== "function") continue;
    (limited as Record<string, unknown>)[passthrough] = (...args: unknown[]): unknown =>
      (inner as (...a: unknown[]) => unknown).apply(client, args);
  }

  return limited;
}

/** An armed wait: what the limiter blocks on, and how it ended. */
interface ArmedWait {
  signal: AbortSignal | undefined;
  /** True only if OUR timer fired — never merely that the signal aborted. */
  hasTimedOut: () => boolean;
  dispose: () => void;
}

const NOT_ARMED = (signal: AbortSignal | undefined): ArmedWait => ({
  signal,
  hasTimedOut: () => false,
  dispose: () => {
    // Nothing was armed, so there is nothing to clear.
  },
});

/**
 * Arm the wait bound, but only when the limiter is ALREADY saturated.
 *
 * On the ordinary path a slot is free and `acquire` resolves without waiting at
 * all, so arming anything would cost a timer and an `AbortSignal.any` per
 * statement — millions a day — to bound a wait that never happens.
 *
 * A plain timer rather than `AbortSignal.timeout` for two reasons: it can be
 * CLEARED the moment the statement is admitted, where a timeout signal holds
 * its timer for the full duration regardless, and a saturated limiter would
 * accumulate one per queued statement; and it is fakeable, so the test for this
 * does not have to spend twenty real seconds proving it.
 */
function armWait({
  limiter,
  maxConcurrent,
  signal,
  waitTimeoutMs,
}: {
  limiter: ConcurrencyLimiter;
  maxConcurrent: number;
  signal: AbortSignal | undefined;
  waitTimeoutMs: number;
}): ArmedWait {
  if (limiter.stats().inFlight < maxConcurrent) return NOT_ARMED(signal);

  const controller = new AbortController();
  let hasFired = false;
  const timer = setTimeout(() => {
    hasFired = true;
    controller.abort();
  }, waitTimeoutMs);
  // Never a reason to hold the process open: if nothing else is running there
  // is no statement ahead of this one to wait for.
  timer.unref?.();

  return {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    hasTimedOut: () => hasFired,
    dispose: () => clearTimeout(timer),
  };
}

async function run({
  limiter,
  maxConcurrent,
  instance,
  operation,
  signal,
  waitTimeoutMs,
  task,
}: {
  limiter: ConcurrencyLimiter;
  maxConcurrent: number;
  instance: string;
  operation: LimitedOperation;
  signal: AbortSignal | undefined;
  waitTimeoutMs: number;
  task: () => Promise<unknown>;
}): Promise<unknown> {
  const queuedAt = performance.now();
  let admitted = false;

  const wait = armWait({ limiter, maxConcurrent, signal, waitTimeoutMs });

  try {
    return await limiter.run({
      task: () => {
        admitted = true;
        // The wait is over the moment the slot is taken; holding the timer past
        // here would abort nothing and keep one alive per admitted statement.
        wait.dispose();
        observeClickHouseStatementWait(
          instance,
          operation,
          (performance.now() - queuedAt) / 1000,
        );
        return task();
      },
      signal: wait.signal,
    });
  } catch (error) {
    // Only a refusal is translated. Once admitted, the statement's own errors
    // belong to the layers below - translating them here would relabel a
    // memory limit or a syntax error as overload.
    if (!admitted && error instanceof QueueFullError) {
      incrementClickHouseStatementsShed(instance, operation);
      logger.warn(
        { instance, operation, maxQueued: error.maxQueued },
        "Refused a ClickHouse statement: concurrency wait queue full",
      );
      throw new ClickHouseOverloadedError({ reasons: [toError(error)] });
    }
    // A wait that ran out is the same verdict as a full queue — the server has
    // no capacity for this statement — so it gets the same transient error.
    // Checked against OUR timeout, never the aborted-ness of the composed
    // signal: a caller cancelling its own request must keep surfacing as the
    // cancellation it is, not be relabelled as overload.
    if (!admitted && wait.hasTimedOut()) {
      incrementClickHouseStatementsShed(instance, operation);
      logger.warn(
        {
          instance,
          operation,
          waitedMs: Math.round(performance.now() - queuedAt),
          timeoutMs: waitTimeoutMs,
        },
        "Refused a ClickHouse statement: waited too long for a slot",
      );
      throw new ClickHouseOverloadedError({ reasons: [toError(error)] });
    }
    throw error;
  } finally {
    wait.dispose();
  }
}
