import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NonRetryableGroupQueueError } from "../errors";
import { GroupQueueProcessor } from "../groupQueue";
import type { GroupQueueRuntimeDefinition } from "../contracts";

type TestPayload = {
  id: string;
  groupId: string;
  __jobType?: string;
  __jobName?: string;
};

function createQueueDefinition(
  overrides: Partial<GroupQueueRuntimeDefinition<TestPayload>> & {
    process: (payload: TestPayload) => Promise<void>;
  },
): GroupQueueRuntimeDefinition<TestPayload> {
  return {
    name: `{test/gqfaillog/${crypto.randomUUID().slice(0, 8)}}`,
    groupKey: (p) => p.groupId,
    identify: (p) => p.id,
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
describe("GroupQueueProcessor - failure logging", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
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
    await redis.quit();
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
  function spyOnLogger(queue: GroupQueueProcessor<TestPayload>, level: "warn" | "error") {
    const logger = (queue as unknown as { logger: Record<string, unknown> }).logger;
    return vi.spyOn(logger as never, level as never) as ReturnType<typeof vi.spyOn>;
  }

  function loggedObjectFor(
    spy: ReturnType<typeof vi.spyOn>,
    message: string,
  ): Record<string, unknown> | undefined {
    const call = spy.mock.calls.find((c: unknown[]) => c[1] === message);
    return call?.[0] as Record<string, unknown> | undefined;
  }

  describe("given a handler that throws a retryable error", () => {
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
          loggedObjectFor(warnSpy, "Job attempt failed, re-staged with backoff"),
        ).toBeDefined();
        expect(
          loggedObjectFor(errorSpy, "Group blocked after exhausted retries, job re-staged"),
        ).toBeUndefined();
      });
    });
  });

  describe("given a handler that throws a non-retryable error", () => {
    describe("when the job skips retries and the group is blocked", () => {
      /** @scenario "The layer that gives up logs at error" */
      it("logs the full Error on both the non-retryable and blocked records", async () => {
        function invalidPayloadHandlerForStackAssertion(): never {
          throw new NonRetryableGroupQueueError("bad payload");
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
              loggedObjectFor(errorSpy, "Group blocked after exhausted retries, job re-staged"),
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
});
