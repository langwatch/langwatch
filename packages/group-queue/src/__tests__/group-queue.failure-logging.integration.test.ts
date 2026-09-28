import IORedis, { type Redis } from "ioredis";
import { createTestLogger, type TestLogLines } from "@langwatch/test-harness";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

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
 * A handler crash seen only as `error.message` is undiagnosable — no file,
 * no line, and the queue is the only witness. These tests pin that every
 * failure-path log carries the full Error object, so a crash traces to its call site.
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

  function createQueue(processFn: (payload: TestPayload) => Promise<void>): {
    queue: GroupQueueProcessor<TestPayload>;
    lines: TestLogLines;
  } {
    const definition = createQueueDefinition({ process: processFn });
    const { logger, lines } = createTestLogger();
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
      logger: logger.child({}, { serializers: { error: serializeCause } }),
    });
    queues.push(queue);
    return { queue, lines };
  }

  /** A pre-flattened string passes through without a stack; only an Error INSTANCE yields one. */
  function serializeCause(value: unknown): unknown {
    return value instanceof Error ? { type: value.name, stack: value.stack } : value;
  }

  function loggedCauseStack(lines: TestLogLines, message: string): unknown {
    const cause = lines.findLine("error", message)?.error;
    return typeof cause === "object" && cause !== null && "stack" in cause
      ? cause.stack
      : undefined;
  }

  describe("given a handler that throws a retryable error", () => {
    describe("when a later attempt succeeds", () => {
      // The whole point of the level split. A run that recovers has not
      // failed, so it must leave nothing at error — otherwise every
      // transient ClickHouse refusal pages someone for work that landed.
      /** @scenario "A retried attempt that later succeeds leaves no error record" */
      it("leaves a warning for the failed attempt and nothing at error", async () => {
        let attempts = 0;
        const { queue, lines } = createQueue(async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("Too many queries in flight");
          }
        });
        await queue.waitUntilReady();

        await queue.send({ id: "job-1", groupId: "g1" });

        await vi.waitFor(
          () => {
            expect(attempts).toBeGreaterThanOrEqual(2);
          },
          { timeout: 15000, interval: 50 },
        );

        expect(lines.findLine("warn", "Job attempt failed, re-staged with backoff")).toBeDefined();
        expect(
          lines.findLine("error", "Group blocked after exhausted retries, job re-staged"),
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
        const { queue, lines } = createQueue(async () => {
          invalidPayloadHandlerForStackAssertion();
        });
        await queue.waitUntilReady();

        await queue.send({ id: "job-1", groupId: "g1" });

        await vi.waitFor(
          () => {
            expect(
              lines.findLine("error", "Group blocked after exhausted retries, job re-staged"),
            ).toBeDefined();
          },
          { timeout: 5000, interval: 50 },
        );

        expect(
          loggedCauseStack(lines, "Job failed with non-retryable error, skipping retries"),
        ).toContain("invalidPayloadHandlerForStackAssertion");
        expect(
          loggedCauseStack(lines, "Group blocked after exhausted retries, job re-staged"),
        ).toContain("invalidPayloadHandlerForStackAssertion");
      });
    });
  });
});
