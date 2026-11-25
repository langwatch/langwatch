import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { beforeEach, describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const PREFIX = "prev:gq:";
const envelope = (pipelineName: string): string => {
  const header = JSON.stringify({ v: 2, e: "j", p: pipelineName });
  return `GQ2|${header.length}|${header}{}`;
};

describe("QueueRedisRepository.drainAllBlockedPreview", () => {
  let repo: QueueRedisRepository;

  beforeEach(async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    const key = (groupId: string, suffix: string) => `${PREFIX}group:${groupId}:${suffix}`;
    const seed = async (groupId: string, message: string | null, pipelineName: string | null) => {
      await redis.sadd(`${PREFIX}blocked`, groupId);
      if (message !== null) await redis.hset(key(groupId, "error"), { message });
      if (pipelineName === null) return;
      await redis.zadd(key(groupId, "jobs"), 1, `${groupId}-job`);
      await redis.hset(key(groupId, "data"), { [`${groupId}-job`]: envelope(pipelineName) });
    };
    await seed("g1", "Timeout after 30000ms", "trace");
    await seed("g2", "Timeout after 12ms", "trace");
    await seed("g3", "HTTP 500 from upstream", "eval");
    await seed("g4", null, "eval");
    await seed("g5", "HTTP 500 from upstream", null);
    await redis.zadd(`${PREFIX}group:g6:jobs`, 1, "orphan");
    await redis.sadd(`${PREFIX}blocked`, "g6");
    repo = QueueRedisRepository.create({ redis });
  });

  it.each([
    [{}],
    [{ errorFilter: "timeout" }],
    [{ errorFilter: "HTTP" }],
    [{ pipelineFilter: "eval" }],
    [{ pipelineFilter: "unknown" }],
    [{ pipelineFilter: "trace", errorFilter: "12ms" }],
    [{ errorFilter: "nothing" }],
  ])("previews %j by pipeline and normalised error", async (filters) => {
    expect(await repo.drainAllBlockedPreview({ queueName: "prev", ...filters })).toMatchSnapshot();
  });
});
