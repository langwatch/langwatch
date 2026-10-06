import type { ClickHouseClient } from "@clickhouse/client";
import {
  ConcurrencyLimiter,
  QueueFullError,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { toError } from "~/utils/posthogErrorCapture";
import {
  incrementClickHouseStatementsShed,
  type LimiterLane,
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
 * The fraction of a process's statement slots each kind of work keeps in
 * reserve for the OTHER kind.
 *
 * An async insert with `wait_for_async_insert=1` holds its connection until the
 * server flushes the buffer, so it is slow by design, not by fault. With one
 * bound shared by everything, ingest could occupy every slot and the UI's reads
 * queued behind it until they timed out. Reserving a minimum per kind keeps a
 * flood of either from starving the other, without the waste of a hard half:
 * whichever kind is idle, the other borrows its slots. A quarter is the neutral
 * starting point; tune it per deployment with
 * `CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE`.
 */
export const DEFAULT_LANE_RESERVE_SHARE = 0.25;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Work-conserving caps for the insert and read lanes over one slot budget.
 *
 * The earlier design cut the budget into two hard halves, which stranded the
 * machine: an insert-only or read-only process could reach only its own half
 * while the other sat idle. ADR-114 §2 settled that a lone producer may use the
 * whole budget, so the lanes have to BORROW rather than OWN.
 *
 * The lever is a reserve, not a share. `reserve` slots are held back for the
 * OTHER kind of work, and a lane may hold everything else — `laneCap =
 * N - reserve`. So a lone lane borrows all but `reserve`, and whichever lane
 * saturates, the other still finds `reserve` slots free: the guarantee hard
 * lanes gave, without the idle capacity they left on the floor.
 *
 * The reserve is clamped so neither extreme can erase it — at least one slot, so
 * a lane cannot be configured out of existence, and at most half the budget, so
 * the slots held back for one lane never exceed what that lane may itself use.
 * A budget under two slots cannot hold both a reserve and a working lane, so it
 * returns `null`; the caller then keeps one shared bound rather than starving
 * either kind.
 */
export function statementLaneCaps({
  maxConcurrent,
  reserveShare,
}: {
  maxConcurrent: number;
  reserveShare: number;
}): { reserve: number; laneCap: number } | null {
  if (maxConcurrent < 2) return null;
  const reserve = clamp(
    Math.round(maxConcurrent * reserveShare),
    1,
    Math.floor(maxConcurrent / 2),
  );
  return { reserve, laneCap: maxConcurrent - reserve };
}

/** A mutable count of the statements a lane is actually running on the driver. */
interface Running {
  count: number;
}

/**
 * One kind of work's lane: the cap limiter it must enter before the total
 * limiter, and a count of what it is running right now.
 *
 * `cap` bounds how many of this kind may hold or wait on a total slot, which is
 * what keeps the other kind's reserve free. It is `null` only for the single
 * shared "all" lane of a budget too small to split, where there is nothing to
 * reserve against and the total limiter is the whole bound.
 */
interface Lane {
  lane: LimiterLane;
  cap: ConcurrencyLimiter | null;
  capMax: number;
  maxQueued: number;
  running: Running;
}

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

function buildLane(lane: LimiterLane, capMax: number, withCap: boolean): Lane {
  const maxQueued = Math.max(MIN_QUEUE_DEPTH, capMax * QUEUE_DEPTH_PER_SLOT);
  return {
    lane,
    capMax,
    maxQueued,
    running: { count: 0 },
    cap: withCap
      ? new ConcurrencyLimiter({ maxConcurrent: capMax, maxQueued })
      : null,
  };
}

/** The limiters a process runs its statements through, and how to route one. */
interface Lanes {
  total: ConcurrencyLimiter;
  totalMax: number;
  reserve: number;
  lanes: Lane[];
  laneFor: (operation: LimitedOperation) => Lane;
}

/**
 * Builds the total ceiling and the per-kind lane caps, or a single shared bound
 * when the budget is too small to reserve against.
 */
function buildLanes({
  maxConcurrent,
  reserveShare,
}: {
  maxConcurrent: number;
  reserveShare: number;
}): Lanes {
  const totalMaxQueued = Math.max(
    MIN_QUEUE_DEPTH,
    maxConcurrent * QUEUE_DEPTH_PER_SLOT,
  );
  const total = new ConcurrencyLimiter({
    maxConcurrent,
    maxQueued: totalMaxQueued,
  });

  const caps = statementLaneCaps({ maxConcurrent, reserveShare });
  if (!caps) {
    const all = buildLane("all", maxConcurrent, false);
    return {
      total,
      totalMax: maxConcurrent,
      reserve: 0,
      lanes: [all],
      laneFor: () => all,
    };
  }

  const insert = buildLane("insert", caps.laneCap, true);
  const read = buildLane("read", caps.laneCap, true);
  return {
    total,
    totalMax: maxConcurrent,
    reserve: caps.reserve,
    lanes: [insert, read],
    laneFor: (op) => (op === "insert" ? insert : read),
  };
}

/**
 * A lane's metrics: what it is running on the driver, and everything waiting
 * behind its cap — both the statements still waiting for a cap slot and those
 * holding one but blocked on the shared total limiter.
 */
function laneStats(
  lane: Lane,
  total: ConcurrencyLimiter,
): { lane: LimiterLane; inFlight: number; queued: number } {
  if (!lane.cap) {
    return {
      lane: lane.lane,
      inFlight: lane.running.count,
      queued: total.stats().queued,
    };
  }
  const { inFlight, queued } = lane.cap.stats();
  return {
    lane: lane.lane,
    inFlight: lane.running.count,
    queued: queued + inFlight - lane.running.count,
  };
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
 *
 * The axis of the split is statement KIND — inserts versus reads (`query`,
 * `command` and `exec`) — which is orthogonal to ADR-114 §2's per-producer fair
 * share: that bounds WHO issues the work, this bounds WHAT KIND it is. One total
 * limiter is the hard ceiling and is never exceeded. Each kind has its own cap
 * one reserve below the total, so whichever kind saturates, the other always
 * finds that reserve free — yet a lone kind still borrows every slot except the
 * other kind's small reserve, so an insert-only or read-only process is not
 * throttled to half the pool. A budget under two slots cannot reserve and stays
 * one shared bound.
 */
export function withStatementLimit<T extends ClickHouseClient>({
  client,
  maxConcurrent,
  instance,
  reserveShare = DEFAULT_LANE_RESERVE_SHARE,
  waitTimeoutMs = STATEMENT_WAIT_TIMEOUT_MS,
}: {
  client: T;
  maxConcurrent: number;
  instance: string;
  /** Fraction of `maxConcurrent` each kind keeps in reserve for the other. */
  reserveShare?: number;
  /** Overridable so a test can prove the bound without spending it. */
  waitTimeoutMs?: number;
}): T {
  const { total, totalMax, reserve, lanes, laneFor } = buildLanes({
    maxConcurrent,
    reserveShare,
  });

  registerClickHouseLimiter(instance, () =>
    lanes.map((l) => laneStats(l, total)),
  );

  logger.info(
    {
      instance,
      maxConcurrent,
      reserve,
      lanes: lanes.map((l) => ({
        lane: l.lane,
        cap: l.capMax,
        maxQueued: l.maxQueued,
      })),
    },
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

    const lane = laneFor(operation);

    (limited as Record<string, unknown>)[operation] = (params: unknown) =>
      run({
        lane,
        total,
        totalMax,
        instance,
        operation,
        signal: signalOf(params),
        waitTimeoutMs,
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
 * Arm the wait bound, but only when a slot is ALREADY unavailable.
 *
 * `saturated` folds both limiters a statement must pass: its lane cap and the
 * shared total. On the ordinary path a slot is free on both and `acquire`
 * resolves without waiting, so arming anything would cost a timer and an
 * `AbortSignal.any` per statement — millions a day — to bound a wait that never
 * happens.
 *
 * A plain timer rather than `AbortSignal.timeout` for two reasons: it can be
 * CLEARED the moment the statement is admitted, where a timeout signal holds
 * its timer for the full duration regardless, and a saturated limiter would
 * accumulate one per queued statement; and it is fakeable, so the test for this
 * does not have to spend twenty real seconds proving it.
 */
function armWait({
  saturated,
  signal,
  waitTimeoutMs,
}: {
  saturated: boolean;
  signal: AbortSignal | undefined;
  waitTimeoutMs: number;
}): ArmedWait {
  if (!saturated) return NOT_ARMED(signal);

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
    signal: signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal,
    hasTimedOut: () => hasFired,
    dispose: () => clearTimeout(timer),
  };
}

/** Is a slot unavailable on either the lane cap or the shared total? */
function isSaturated(
  lane: Lane,
  total: ConcurrencyLimiter,
  totalMax: number,
): boolean {
  if (total.stats().inFlight >= totalMax) return true;
  return lane.cap ? lane.cap.stats().inFlight >= lane.capMax : false;
}

/**
 * Enter the lane cap, then the shared total, then run. The lane cap bounds how
 * many of this kind can hold or wait on a total slot, which is what keeps the
 * other kind's reserve reachable. The "all" lane has no cap and enters the
 * total directly.
 */
function acquire({
  lane,
  total,
  onDriver,
  signal,
}: {
  lane: Lane;
  total: ConcurrencyLimiter;
  onDriver: () => Promise<unknown>;
  signal: AbortSignal | undefined;
}): Promise<unknown> {
  const runInTotal = () => total.run({ task: onDriver, signal });
  if (!lane.cap) return runInTotal();
  return lane.cap.run({ task: runInTotal, signal });
}

/**
 * The transient error a refused statement should surface, or `undefined` to
 * rethrow the original. Only a refusal is translated: once admitted, the
 * statement's own errors belong to the layers below, and translating them here
 * would relabel a memory limit or a syntax error as overload.
 */
function refusalFor({
  error,
  admitted,
  instance,
  operation,
  queuedAt,
  waitTimeoutMs,
  hasTimedOut,
}: {
  error: unknown;
  admitted: boolean;
  instance: string;
  operation: LimitedOperation;
  queuedAt: number;
  waitTimeoutMs: number;
  hasTimedOut: () => boolean;
}): ClickHouseOverloadedError | undefined {
  if (admitted) return undefined;

  // A full queue on EITHER limiter is the same verdict: no capacity for this
  // statement.
  if (error instanceof QueueFullError) {
    incrementClickHouseStatementsShed(instance, operation);
    logger.warn(
      { instance, operation, maxQueued: error.maxQueued },
      "Refused a ClickHouse statement: concurrency wait queue full",
    );
    return new ClickHouseOverloadedError({ reasons: [toError(error)] });
  }

  // A wait that ran out is the same verdict as a full queue. Checked against
  // OUR timeout, never the aborted-ness of the composed signal: a caller
  // cancelling its own request must keep surfacing as the cancellation it is,
  // not be relabelled as overload.
  if (hasTimedOut()) {
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
    return new ClickHouseOverloadedError({ reasons: [toError(error)] });
  }

  return undefined;
}

async function run({
  lane,
  total,
  totalMax,
  instance,
  operation,
  signal,
  waitTimeoutMs,
  task,
}: {
  lane: Lane;
  total: ConcurrencyLimiter;
  totalMax: number;
  instance: string;
  operation: LimitedOperation;
  signal: AbortSignal | undefined;
  waitTimeoutMs: number;
  task: () => Promise<unknown>;
}): Promise<unknown> {
  const queuedAt = performance.now();
  let admitted = false;

  // One armed wait covers both limiters: the composed signal is passed to the
  // lane cap and the total alike, so whichever makes the statement wait, the
  // same timeout bounds it.
  const wait = armWait({
    saturated: isSaturated(lane, total, totalMax),
    signal,
    waitTimeoutMs,
  });

  const onDriver = async () => {
    // Admission is the innermost point - both the lane cap and the total have
    // granted a slot - so the wait is over and `admitted` is set only here.
    admitted = true;
    lane.running.count += 1;
    wait.dispose();
    observeClickHouseStatementWait(
      instance,
      operation,
      (performance.now() - queuedAt) / 1000,
    );
    try {
      return await task();
    } finally {
      lane.running.count -= 1;
    }
  };

  try {
    return await acquire({ lane, total, onDriver, signal: wait.signal });
  } catch (error) {
    const refusal = refusalFor({
      error,
      admitted,
      instance,
      operation,
      queuedAt,
      waitTimeoutMs,
      hasTimedOut: wait.hasTimedOut,
    });
    throw refusal ?? error;
  } finally {
    wait.dispose();
  }
}
