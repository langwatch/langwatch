import type { ClickHouseClient } from "@clickhouse/client";
import {
  type ConcurrencyLimiter,
  createConcurrencyLimiter,
  QueueFullError,
} from "@langwatch/clickhouse-client";
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
}: {
  client: T;
  maxConcurrent: number;
  instance: string;
}): T {
  const maxQueued = Math.max(
    MIN_QUEUE_DEPTH,
    maxConcurrent * QUEUE_DEPTH_PER_SLOT,
  );
  const limiter = createConcurrencyLimiter({ maxConcurrent, maxQueued });

  registerClickHouseLimiter(instance, () => limiter.stats());

  logger.info(
    { instance, maxConcurrent, maxQueued },
    "ClickHouse statement concurrency bounded",
  );

  const limited = Object.create(client) as T;

  for (const operation of [
    "query",
    "insert",
    "command",
    "exec",
  ] as LimitedOperation[]) {
    const inner = client[operation];
    // A driver that does not expose one of these is not an error worth
    // failing a boot over - leave the property alone and let the prototype
    // chain answer for it.
    if (typeof inner !== "function") continue;

    (limited as Record<string, unknown>)[operation] = (params: unknown) =>
      run({
        limiter,
        instance,
        operation,
        signal: signalOf(params),
        task: () =>
          (inner as (p: unknown) => Promise<unknown>).call(client, params),
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
    (limited as Record<string, unknown>)[passthrough] = (
      ...args: unknown[]
    ): unknown => (inner as (...a: unknown[]) => unknown).apply(client, args);
  }

  return limited;
}

async function run({
  limiter,
  instance,
  operation,
  signal,
  task,
}: {
  limiter: ConcurrencyLimiter;
  instance: string;
  operation: LimitedOperation;
  signal: AbortSignal | undefined;
  task: () => Promise<unknown>;
}): Promise<unknown> {
  const queuedAt = performance.now();
  let admitted = false;

  try {
    return await limiter.run(() => {
      admitted = true;
      observeClickHouseStatementWait(
        instance,
        operation,
        (performance.now() - queuedAt) / 1000,
      );
      return task();
    }, signal);
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
    throw error;
  }
}
