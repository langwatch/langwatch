import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const envelope = (pipelineName: string): string => {
  const header = JSON.stringify({ v: 2, e: "j", p: pipelineName });
  return `GQ2|${header.length}|${header}{}`;
};

describe("QueueRedisRepository.getBlockedSummary", () => {
  it("clusters blocked groups by pipeline and normalised error across queues, sampling five ids", async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    const seed = async ({
      queue,
      groupId,
      message,
      stack,
      pipelineName,
    }: {
      queue: string;
      groupId: string;
      message?: string;
      stack?: string;
      pipelineName?: string;
    }) => {
      const key = (suffix: string) => `${queue}:gq:group:${groupId}:${suffix}`;
      await redis.sadd(`${queue}:gq:blocked`, groupId);
      if (message) await redis.hset(key("error"), { message, ...(stack ? { stack } : {}) });
      if (!pipelineName) return;
      await redis.zadd(key("jobs"), 1, `${groupId}-job`);
      await redis.hset(key("data"), { [`${groupId}-job`]: envelope(pipelineName) });
    };
    for (let i = 0; i < 7; i++) {
      await seed({
        queue: "qa",
        groupId: `t${i}`,
        message: "Timeout after 100ms",
        stack: "s",
        pipelineName: "trace",
      });
    }
    await seed({ queue: "qa", groupId: "e1", message: "Timeout after 5ms", pipelineName: "eval" });
    await seed({ queue: "qa", groupId: "u1" });
    await seed({ queue: "qb", groupId: "b1", message: "HTTP 500", pipelineName: "trace" });
    await seed({ queue: "qb", groupId: "b2", message: "HTTP 500" });

    const summary = await QueueRedisRepository.create({ redis }).getBlockedSummary({
      queueNames: ["qa", "qb", "qempty"],
    });

    expect(summary.totalBlocked).toBe(11);
    expect(
      summary.clusters.map((c) => ({ ...c, sampleGroupIds: c.sampleGroupIds.toSorted() })),
    ).toMatchSnapshot();
  });
});
