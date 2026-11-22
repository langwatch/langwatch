import { randomUUID } from "node:crypto";

import {
  defineGroupQueue,
  GroupQueueConsumer,
  GroupQueueError,
  GroupQueueProducer,
  HandBackGroupQueueError,
  NonRetryableGroupQueueError,
  type GroupQueueDependencies,
  type RunningGroupQueueConsumer,
} from "@langwatch/group-queue";
import { createLogger, type Logger } from "@langwatch/observability";

import { incrementEsJobsProjectGone } from "../metrics.ts";
import {
  classifyClickHouseError,
  ErrorCategory,
  FoldStateNotVisibleError,
  isOutOfStatementSlots,
  isPermanentClickHouseError,
  isProjectGone,
  isQueryMemoryLimitExceeded,
  UndeclaredQueuedEventTypeError,
  UnroutableQueuedJobError,
} from "../services/errorHandling.ts";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  JobDelivery,
} from "./queue.types.ts";

const logger = createLogger("langwatch:event-sourcing:group-queue");

export interface EventingGroupQueueFactoryOptions {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  consumersEnabled?: boolean;
  /** A second consumer runs only the groups on lists `runListedWork` opens, ahead of the rest. */
  listedConsumer?: boolean;
}

/** A schema refusal is deterministic: retrying the same value would only fail 25 times. */
export async function refuseInvalidValueOnce<T>({
  queueName,
  run,
}: {
  queueName: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof Error && "issues" in error && Array.isArray(error.issues))) throw error;
    throw new NonRetryableGroupQueueError(
      `Queue ${queueName} refused a value that fails its schema: ${error.message}`,
      { cause: error },
    );
  }
}

/**
 * A shared flush hands one caller's parse error to every member (ADR-187). Before the eighth
 * attempt a job has waited up to 16 s and then 32 s, so an innocent flush-mate has long since run
 * in a clean sub-second flush; with jitter, attempts 1 to 3 can all land within 1.5 s.
 */
const REFUSED_DATA_ATTEMPTS = 8;

/** A ClickHouse parse or type refusal fails the same way every time: stop retrying it soon. */
export async function stopRetryingRefusedData<T>({
  queueName,
  attempt,
  run,
}: {
  queueName: string;
  attempt: number;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (attempt < REFUSED_DATA_ATTEMPTS) throw error;
    if (!isPermanentClickHouseError(error)) throw error;
    // The refusal's own message may quote the row it could not parse, so it stays in the cause.
    throw new NonRetryableGroupQueueError(
      `Queue ${queueName} stopped retrying a job whose data ClickHouse refused as unparseable or of the wrong type, on attempt ${attempt}`,
      { cause: error },
    );
  }
}

/**
 * A job this worker has no handler for, or whose event type it does not declare, goes back to
 * the queue without using an attempt (Alex, 2026-10-12).
 */
export async function handBackUnroutable<T>({ run }: { run: () => Promise<T> }): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const unhandled =
      error instanceof UnroutableQueuedJobError || error instanceof UndeclaredQueuedEventTypeError;
    if (!unhandled) throw error;
    throw new HandBackGroupQueueError(error.message, { cause: error });
  }
}

/**
 * A job whose project was deleted after it was queued can never succeed, whatever its kind
 * (command, fold, map, subscriber, process manager): it completes as a logged no-op instead of
 * retrying into a blocked group (specs/eventing/deleted-project-jobs.feature).
 */
export async function completeWhenProjectGone({
  queueName,
  payloads,
  run,
  log = logger,
}: {
  queueName: string;
  payloads: readonly Record<string, unknown>[];
  run: () => Promise<void>;
  log?: Logger;
}): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isProjectGone(error)) throw error;
    const first = payloads[0];
    incrementEsJobsProjectGone({
      queue: queueName,
      jobType: typeof first?.__jobType === "string" ? first.__jobType : "unknown",
      count: payloads.length,
    });
    log.warn(
      {
        tenantId: first?.tenantId ?? null,
        queueName,
        jobType: first?.__jobType ?? null,
        jobName: first?.__jobName ?? null,
        jobs: payloads.length,
      },
      "Job's project no longer exists; completing it as a no-op",
    );
  }
}

/** The first error in a cause chain that ClickHouse's own classification calls transient. */
function overloadedClickHouseError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    if (classifyClickHouseError(current) === ErrorCategory.RECOVERABLE) return current;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/** A least wait and the random spread above it, so jobs refused together do not return together. */
interface JitteredWait {
  minMs: number;
  spreadMs: number;
}

/** The least wait before work refused a statement slot runs again, and the spread above it. */
const NO_STATEMENT_SLOT_RETRY: JitteredWait = { minMs: 2_000, spreadMs: 3_000 };

/**
 * The wait before a fold whose saved state was not visible yet runs again: long enough for a
 * lagging replica to catch up, short enough that the aggregate's next events barely wait.
 */
const FOLD_STATE_NOT_VISIBLE_RETRY: JitteredWait = { minMs: 2_000, spreadMs: 3_000 };

function jitteredWaitMs({ minMs, spreadMs }: JitteredWait): number {
  return minMs + Math.floor(Math.random() * spreadMs);
}

/**
 * The retry delay an overload names. Out of statement slots, the work waits a randomised 2 to
 * 5 seconds, so the jobs one burst refused do not take the slots back together; any other
 * overload leaves the wait to the queue's own backoff.
 */
function overloadRetryAfterMs(overloaded: unknown): number {
  if (!isOutOfStatementSlots(overloaded)) return 0;
  return jitteredWaitMs(NO_STATEMENT_SLOT_RETRY);
}

/** The first FoldStateNotVisibleError in a cause chain. */
function foldStateNotVisibleIn(error: unknown): FoldStateNotVisibleError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    if (current instanceof FoldStateNotVisibleError) return current;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/**
 * A fold whose saved state is not visible yet names a jittered retry delay of 2 to 5 seconds, so
 * the retry reads once the replica has most likely caught up. A batch backs off whole: splitting
 * it would only miss the same state sooner. The fold itself bounds how often this happens.
 */
export async function retrySoonWhenFoldStateNotVisible<T>({
  queueName,
  run,
  unit = "batch",
}: {
  queueName: string;
  run: () => Promise<T>;
  unit?: "batch" | "job";
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const notVisible = foldStateNotVisibleIn(error);
    if (notVisible === undefined) throw error;
    throw new GroupQueueError({
      queueName,
      operation: unit === "batch" ? "processBatch" : "process",
      message: notVisible.message,
      cause: error,
      retryAfterMs: jitteredWaitMs(FOLD_STATE_NOT_VISIBLE_RETRY),
    });
  }
}

function codeOf(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown";
}

/**
 * An overloaded ClickHouse fails a smaller batch just the same, so the batch names a retry
 * delay and backs off whole. A statement over its own memory limit is the batch's size, not
 * the server's load, so it splits (packages/group-queue/specs/batch-bisection.feature).
 */
export async function backOffWhenOverloaded<T>({
  queueName,
  run,
  unit = "batch",
}: {
  queueName: string;
  run: () => Promise<T>;
  /** A single job has nothing to split; it still takes the overload retry budget. */
  unit?: "batch" | "job";
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw overloadFailureOf({ error, queueName, unit });
  }
}

/** The failure to throw for a run: overload names a retry delay, a per-query limit does not. */
function overloadFailureOf({
  error,
  queueName,
  unit,
}: {
  error: unknown;
  queueName: string;
  unit: "batch" | "job";
}): unknown {
  const overloaded = overloadedClickHouseError(error);
  if (overloaded === undefined) return error;
  const code = codeOf(overloaded);
  const detail = error instanceof Error ? error.message : String(error);
  const operation = unit === "batch" ? "processBatch" : "process";
  if (isQueryMemoryLimitExceeded(error)) {
    const next = unit === "batch" ? "splitting the batch" : "retrying the job";
    return new GroupQueueError({
      queueName,
      operation,
      message: `ClickHouse statement over its memory limit (code ${code}); ${next}: ${detail}`,
      cause: error,
    });
  }
  const next = unit === "batch" ? "backing the batch off whole" : "backing the job off";
  return new GroupQueueError({
    queueName,
    operation,
    message: `ClickHouse overloaded (code ${code}); ${next}: ${detail}`,
    cause: error,
    retryAfterMs: overloadRetryAfterMs(overloaded),
  });
}

/** The queue's own consumer, and one that runs only listed groups when asked for. */
function consumerDependencies({
  dependencies,
  listedConsumer,
}: {
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
  listedConsumer: boolean;
}): GroupQueueDependencies<Record<string, unknown>>[] {
  if (!listedConsumer) return [dependencies];
  return [dependencies, { ...dependencies, dispatchListed: true }];
}

/**
 * Consumers first: a draining job sends its fan-out through THIS producer, whose gate shuts
 * once its own close ends. Every consumer settles before the producer closes; the first drain
 * failure wins over a producer-close failure. Spec: specs/background/queue-drain-send-gate.feature
 */
async function closeConsumersThenProducer({
  consumers,
  producer,
}: {
  consumers: readonly { close: () => Promise<void> }[];
  producer: { close: () => Promise<void> };
}): Promise<void> {
  const drained = await Promise.allSettled(consumers.map((each) => each.close()));
  const failed = drained.find((each): each is PromiseRejectedResult => each.status === "rejected");
  const [producerClosed] = await Promise.allSettled([producer.close()]);
  if (failed) throw failed.reason;
  if (producerClosed?.status === "rejected") throw producerClosed.reason;
}

/**
 * Adapts the capability-split Group Queue API to Eventing's shared runtime
 * queue port. Application composition owns the Redis and storage dependencies;
 * Eventing owns only the routing definition and handler registry.
 */
export function createEventingGroupQueueFactory({
  dependencies,
  consumersEnabled = true,
  listedConsumer = false,
}: EventingGroupQueueFactoryOptions): (
  definition: EventSourcedQueueDefinition<Record<string, unknown>>,
) => EventSourcedQueueProcessor<Record<string, unknown>> {
  return (eventingDefinition) => {
    const queueDefinition = defineGroupQueue({
      name: eventingDefinition.name,
      payload: {
        parse(value): Record<string, unknown> {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Eventing queue payload must be an object");
          }
          return value as Record<string, unknown>;
        },
      },
      groupBy: (payload) => eventingDefinition.groupKey?.(payload) ?? randomUUID(),
      identify: () => randomUUID(),
      score: eventingDefinition.score,
      spanAttributes: eventingDefinition.spanAttributes,
      delay: eventingDefinition.delay,
      deduplication: eventingDefinition.deduplication,
      coalescing: eventingDefinition.processBatch
        ? {
            maxItems: eventingDefinition.coalesceMaxBatch ?? (() => 1),
            maxBytes: eventingDefinition.coalesceMaxBytes,
          }
        : undefined,
      onExhausted: eventingDefinition.onExhausted,
    });

    const refuse = <T>(run: () => Promise<T>) =>
      handBackUnroutable({
        run: () => refuseInvalidValueOnce({ queueName: eventingDefinition.name, run }),
      });
    const producer = new GroupQueueProducer(queueDefinition, dependencies);
    let consumers: RunningGroupQueueConsumer<Record<string, unknown>>[] = [];
    // Claiming starts on `start()`, never at construction: a job claimed before
    // every pipeline registered its handler has nowhere to go.
    const startConsuming = (
      consumerDependencies: GroupQueueDependencies<Record<string, unknown>>,
    ): RunningGroupQueueConsumer<Record<string, unknown>> => {
      const configuredConsumer = new GroupQueueConsumer(queueDefinition, consumerDependencies);
      // Only a single job is refused for its data: a coalesced batch bisects to find the culprit.
      const one = (payload: Record<string, unknown>, context: JobDelivery | undefined) =>
        retrySoonWhenFoldStateNotVisible({
          queueName: eventingDefinition.name,
          unit: "job",
          run: () =>
            backOffWhenOverloaded({
              queueName: eventingDefinition.name,
              unit: "job",
              run: () =>
                stopRetryingRefusedData({
                  queueName: eventingDefinition.name,
                  attempt: context?.attempt ?? 1,
                  run: () =>
                    refuse(() =>
                      completeWhenProjectGone({
                        queueName: eventingDefinition.name,
                        payloads: [payload],
                        run: () => eventingDefinition.process(payload, context),
                      }),
                    ),
                }),
            }),
        });
      return eventingDefinition.processBatch
        ? configuredConsumer.handleBatch({
            each: one,
            batch: (payloads, context) =>
              retrySoonWhenFoldStateNotVisible({
                queueName: eventingDefinition.name,
                run: () =>
                  backOffWhenOverloaded({
                    queueName: eventingDefinition.name,
                    run: () =>
                      refuse(() =>
                        completeWhenProjectGone({
                          queueName: eventingDefinition.name,
                          payloads,
                          run: () => eventingDefinition.processBatch!(payloads, context),
                        }),
                      ),
                  }),
              }),
          })
        : configuredConsumer.handle(one);
    };

    return {
      send: (payload, options) => producer.send(payload, options),
      sendBatch: (payloads, options) => producer.sendBatch(payloads, options),
      sendEach: (payloads, options) => producer.sendEach(payloads, options),
      runListedWork: (input) => producer.runListedWork(input),
      start() {
        if (!consumersEnabled || consumers.length > 0) return;
        consumers = consumerDependencies({ dependencies, listedConsumer }).map(startConsuming);
      },
      pause: () => consumers.forEach((each) => each.pause()),
      resume: () => consumers.forEach((each) => each.resume()),
      async waitUntilReady() {
        await Promise.all([
          producer.waitUntilReady(),
          ...consumers.map((each) => each.waitUntilReady()),
        ]);
      },
      close: () => closeConsumersThenProducer({ consumers, producer }),
    };
  };
}
