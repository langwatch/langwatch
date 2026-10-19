import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const PREFIX = "dlqq:gq:";
const envelope = (pipelineName: string): string => {
  const header = JSON.stringify({ v: 2, e: "j", p: pipelineName });
  return `GQ2|${header.length}|${header}{}`;
};

describe("QueueRedisRepository.findDlqGroups", () => {
  it("lists every dead-lettered group with its error, head-job pipeline and job count, newest first", async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    const key = (groupId: string, suffix: string) => `${PREFIX}dlq:${groupId}:${suffix}`;
    await redis.sadd(
      `${PREFIX}dlq`,
      "g-full",
      "g-old",
      "g-bare",
      "g-no-data",
      "g-plain",
      "g-null-p",
    );
    await redis.hset(key("g-full", "error"), {
      message: "boom",
      stack: "at x",
      timestamp: "2000.5",
    });
    await redis.zadd(key("g-full", "jobs"), 1, "j1", 2, "j2");
    await redis.hset(key("g-full", "data"), { j1: envelope("trace") });
    await redis.hset(key("g-old", "error"), { message: "old", timestamp: "10" });
    await redis.zadd(key("g-old", "jobs"), 1, "j3");
    await redis.hset(key("g-old", "data"), { j3: envelope("eval") });
    await redis.zadd(key("g-no-data", "jobs"), 1, "j4");
    await redis.hset(key("g-plain", "error"), { timestamp: "500" });
    await redis.zadd(key("g-plain", "jobs"), 1, "j5");
    await redis.hset(key("g-plain", "data"), { j5: "{}" });
    await redis.zadd(key("g-null-p", "jobs"), 1, "j6");
    await redis.hset(key("g-null-p", "data"), { j6: `GQ2|15|{"v":2,"e":"j"}{}` });

    const groups = await QueueRedisRepository.create({ redis }).findDlqGroups({
      queueName: "dlqq",
    });

    expect(groups).toMatchSnapshot();
  });
});
