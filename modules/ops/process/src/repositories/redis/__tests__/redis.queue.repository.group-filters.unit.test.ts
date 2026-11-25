import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const QUEUE = "filters";
const PREFIX = `${QUEUE}:gq:`;
const GROUPS = ["g-trace-boom", "g-eval-quiet", "g-no-jobs", "g-no-data", "g-not-envelope"];

const envelope = (pipelineName: string): string => {
  const header = JSON.stringify({ v: 2, e: "j", p: pipelineName });
  return `GQ2|${header.length}|${header}{}`;
};

async function seed(redis: Redis, segment: "group" | "dlq"): Promise<void> {
  const setKey = segment === "group" ? `${PREFIX}blocked` : `${PREFIX}dlq`;
  const key = (groupId: string, suffix: string) => `${PREFIX}${segment}:${groupId}:${suffix}`;
  await redis.sadd(setKey, ...GROUPS);
  await redis.hset(key("g-trace-boom", "error"), { message: "Boom: upstream Timeout" });
  await redis.zadd(key("g-trace-boom", "jobs"), 1, "j1");
  await redis.hset(key("g-trace-boom", "data"), { j1: envelope("trace") });
  await redis.zadd(key("g-eval-quiet", "jobs"), 1, "j2");
  await redis.hset(key("g-eval-quiet", "data"), { j2: envelope("eval") });
  await redis.hset(key("g-no-jobs", "error"), { message: "boom" });
  await redis.hset(key("g-no-data", "error"), { message: "BOOM again" });
  await redis.zadd(key("g-no-data", "jobs"), 1, "j4");
  await redis.zadd(key("g-not-envelope", "jobs"), 1, "j5");
  await redis.hset(key("g-not-envelope", "data"), { j5: "{}" });
}

describe("QueueRedisRepository bulk operator filters", () => {
  let evalsha: Mock<(...args: unknown[]) => Promise<unknown>>;
  let repo: QueueRedisRepository;

  beforeEach(async () => {
    const store = memoryRedisStore();
    evalsha = vi.fn(async (..._args: unknown[]): Promise<unknown> => 1);
    const redis = memoryRedisDouble({ store, script: { evalsha } });
    await seed(redis, "group");
    await seed(redis, "dlq");
    repo = QueueRedisRepository.create({ redis });
  });

  const touchedGroups = () =>
    evalsha.mock.calls
      .map((args: unknown[]) => args.find((arg) => GROUPS.includes(String(arg))))
      .toSorted((a, b) => String(a).localeCompare(String(b)));

  describe.each([
    [
      "moving blocked groups to the DLQ",
      (filters: object) => repo.moveAllBlockedToDlq({ queueName: QUEUE, ...filters }),
    ],
    [
      "replaying the DLQ",
      (filters: object) => repo.replayAllFromDlq({ queueName: QUEUE, ...filters }),
    ],
  ])("when %s", (_label, run) => {
    it.each([
      [{}, GROUPS.toSorted((a, b) => String(a).localeCompare(String(b)))],
      [{ errorFilter: "boom" }, ["g-no-data", "g-no-jobs", "g-trace-boom"]],
      [{ errorFilter: "TIMEOUT" }, ["g-trace-boom"]],
      [{ errorFilter: "nothing matches" }, []],
      [{ pipelineFilter: "trace" }, ["g-trace-boom"]],
      [{ pipelineFilter: "eval" }, ["g-eval-quiet"]],
      [{ pipelineFilter: "trace", errorFilter: "boom" }, ["g-trace-boom"]],
      [{ pipelineFilter: "eval", errorFilter: "boom" }, []],
    ])("with filters %j it acts on exactly the matching groups", async (filters, expected) => {
      const result = await run(filters);

      expect(touchedGroups()).toEqual(expected);
      expect(result).toMatchSnapshot();
    });
  });
});
