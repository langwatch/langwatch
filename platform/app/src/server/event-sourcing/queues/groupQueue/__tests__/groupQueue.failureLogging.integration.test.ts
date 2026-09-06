import type { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { ValidationError } from "../../../services/errorHandling";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";

// Skip when running without testcontainers (unit-only test runs)
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

type TestPayload = {
  id: string;
  groupId: string;
};

function createQueueDefinition(
  overrides: Partial<EventSourcedQueueDefinition<TestPayload>> & {
    process: (payload: TestPayload) => Promise<void>;
  },
): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gqfaillog/${crypto.randomUUID().slice(0, 8)}}`,
    groupKey: (p) => p.groupId,
    ...overrides,
  };
}

/**
 * A handler crash observed only as `error.message` is undiagnosable: the
 * message names no file and no line, and the queue is the only place that
 * ever sees the throw. These tests pin that every failure-path log record
 * carries the full Error object — the logger's `error` serializer emits
 * the stack from it — so a production crash can be traced to its call site
 * without a rollback-and-guess cycle.
 */
describe.skipIf(!hasTestcontainers)(
  "GroupQueueProcessor - failure logging",
  () => {
    let redis: Redis;
    let queues: GroupQueueProcessor<TestPayload>[];

    beforeAll(async () => {
      await startTestContainers();
      redis = getTestRedisConnection()!;
    });

    beforeEach(() => {
      queues = [];
    });

    afterEach(async () => {
      await Promise.all(queues.map((q) => q.close().catch(() => {})));
      // Scoped to this suite's own namespace, never flushdb().
      const keys = await redis.keys("{test/gqfaillog/*");
      if (keys.length > 0) await redis.del(...keys);
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function createQueue(
      processFn: (payload: TestPayload) => Promise<void>,
    ): GroupQueueProcessor<TestPayload> {
      const definition = createQueueDefinition({ process: processFn });
      const queue = new GroupQueueProcessor<TestPayload>(definition, redis);
      queues.push(queue);
      return queue;
    }

    /** The logger is a private field; the spy sees the raw log object before
     *  pino serializes it, which is exactly the contract under test: the
     *  Error INSTANCE must reach the logger, not a pre-flattened string. */
    function spyOnLogger(
      queue: GroupQueueProcessor<TestPayload>,
      level: "warn" | "error",
    ) {
      const logger = (queue as unknown as { logger: Record<string, unknown> })
        .logger;
      return vi.spyOn(logger as never, level as never) as ReturnType<
        typeof vi.spyOn
      >;
    }

    function loggedObjectFor(
      spy: ReturnType<typeof vi.spyOn>,
      message: string,
    ): Record<string, unknown> | undefined {
      const call = spy.mock.calls.find((c: unknown[]) => c[1] === message);
      return call?.[0] as Record<string, unknown> | undefined;
    }

    describe("given a handler that throws a retryable error", () => {
      describe("when the job attempt fails and is re-staged", () => {
        it("logs the full Error so the stack survives to the log record", async () => {
          function explodingHandlerForStackAssertion(): never {
            throw new Error("Cannot read properties of undefined");
          }
          const queue = createQueue(async () => {
            explodingHandlerForStackAssertion();
          });
          const warnSpy = spyOnLogger(queue, "warn");
          await queue.waitUntilReady();

          await queue.send({ id: "job-1", groupId: "g1" });

          await vi.waitFor(
            () => {
              expect(
                loggedObjectFor(
                  warnSpy,
                  "Job attempt failed, re-staged with backoff",
                ),
              ).toBeDefined();
            },
            { timeout: 5000, interval: 50 },
          );

          const logged = loggedObjectFor(
            warnSpy,
            "Job attempt failed, re-staged with backoff",
          )!;
          expect(logged.error).toBeInstanceOf(Error);
          const stack = (logged.error as Error).stack ?? "";
          expect(stack).toContain("explodingHandlerForStackAssertion");
        });
      });

      describe("when a later attempt succeeds", () => {
        // The whole point of the level split. A run that recovers has not
        // failed, so it must leave nothing at error — otherwise every
        // transient ClickHouse refusal pages someone for work that landed.
        /** @scenario "A retried attempt that later succeeds leaves no error record" */
        it("leaves a warning for the failed attempt and nothing at error", async () => {
          let attempts = 0;
          const queue = createQueue(async () => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("Too many queries in flight");
            }
          });
          const warnSpy = spyOnLogger(queue, "warn");
          const errorSpy = spyOnLogger(queue, "error");
          await queue.waitUntilReady();

          await queue.send({ id: "job-1", groupId: "g1" });

          await vi.waitFor(
            () => {
              expect(attempts).toBeGreaterThanOrEqual(2);
            },
            { timeout: 15000, interval: 50 },
          );

          expect(
            loggedObjectFor(
              warnSpy,
              "Job attempt failed, re-staged with backoff",
            ),
          ).toBeDefined();
          expect(
            loggedObjectFor(
              errorSpy,
              "Group blocked after exhausted retries, job re-staged",
            ),
          ).toBeUndefined();
        });
      });
    });

    describe("given a handler that throws a non-retryable error", () => {
      describe("when the job skips retries and the group is blocked", () => {
        /** @scenario "The layer that gives up logs at error" */
        it("logs the full Error on both the non-retryable and blocked records", async () => {
          function invalidPayloadHandlerForStackAssertion(): never {
            throw new ValidationError("bad payload", "field");
          }
          const queue = createQueue(async () => {
            invalidPayloadHandlerForStackAssertion();
          });
          const errorSpy = spyOnLogger(queue, "error");
          await queue.waitUntilReady();

          await queue.send({ id: "job-1", groupId: "g1" });

          await vi.waitFor(
            () => {
              expect(
                loggedObjectFor(
                  errorSpy,
                  "Group blocked after exhausted retries, job re-staged",
                ),
              ).toBeDefined();
            },
            { timeout: 5000, interval: 50 },
          );

          const nonRetryable = loggedObjectFor(
            errorSpy,
            "Job failed with non-retryable error, skipping retries",
          )!;
          expect(nonRetryable.error).toBeInstanceOf(Error);
          expect((nonRetryable.error as Error).stack ?? "").toContain(
            "invalidPayloadHandlerForStackAssertion",
          );

          const blocked = loggedObjectFor(
            errorSpy,
            "Group blocked after exhausted retries, job re-staged",
          )!;
          expect(blocked.error).toBeInstanceOf(Error);
          expect((blocked.error as Error).stack ?? "").toContain(
            "invalidPayloadHandlerForStackAssertion",
          );
        });
      });
    });

    describe("given the failure-streak breaker quarantines a group", () => {
      describe("when the stored blocked record is written", () => {
        it("persists the handler's stack, not the quarantine wrapper's", async () => {
          const previous =
            process.env.LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD;
          process.env.LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD = "1";
          try {
            function streakingHandlerForStackAssertion(): never {
              throw new Error("recurring handler failure");
            }
            // Threshold is read at construction, so the env var must be set
            // before createQueue.
            const queue = createQueue(async () => {
              streakingHandlerForStackAssertion();
            });
            const name = (queue as unknown as { queueName: string }).queueName;
            await queue.waitUntilReady();

            await queue.send({ id: "job-1", groupId: "g1" });

            // First failure re-stages with backoff (streak 1); the second
            // crosses the threshold and quarantines the group.
            await vi.waitFor(
              async () => {
                expect(await redis.sismember(`${name}:gq:blocked`, "g1")).toBe(
                  1,
                );
              },
              { timeout: 10_000, interval: 100 },
            );

            const stored = await redis.hgetall(`${name}:gq:group:g1:error`);
            expect(stored.message).toContain("Poison guard");
            // The wrapper explains WHY the group blocked; the persisted stack
            // must still name the handler's throwing line — that is the whole
            // diagnostic value of the record.
            expect(stored.stack).toContain("streakingHandlerForStackAssertion");
          } finally {
            if (previous === undefined) {
              delete process.env.LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD;
            } else {
              process.env.LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD =
                previous;
            }
          }
        });
      });
    });
  },
);
