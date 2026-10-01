import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

type Redis = ReturnType<typeof memoryRedisDouble>;

const envelope = (pipelineName: string): string => {
  const header = JSON.stringify({ v: 2, e: "j", p: pipelineName, t: "project", n: "handle" });
  return `GQ2|${header.length}|${header}{}`;
};

const key = ({ queue, groupId, suffix }: { queue: string; groupId: string; suffix: string }) =>
  `${queue}:gq:group:${groupId}:${suffix}`;

async function seedGroup({
  redis,
  queue,
  groupId,
  ready,
  jobs = [],
  withData = true,
  active,
  attempt,
  error,
  blocked = false,
}: {
  redis: Redis;
  queue: string;
  groupId: string;
  ready?: number;
  jobs?: [string, number][];
  withData?: boolean;
  active?: { jobId: string; ttlSec?: number };
  attempt?: string;
  error?: Record<string, string>;
  blocked?: boolean;
}): Promise<void> {
  if (ready !== undefined) await redis.zadd(`${queue}:gq:ready`, ready, groupId);
  if (blocked) await redis.sadd(`${queue}:gq:blocked`, groupId);
  for (const [jobId, score] of jobs) {
    await redis.zadd(key({ queue, groupId, suffix: "jobs" }), score, jobId);
    if (withData) {
      await redis.hset(key({ queue, groupId, suffix: "data" }), { [jobId]: envelope(groupId) });
    }
  }
  if (active) {
    await redis.set(key({ queue, groupId, suffix: "active" }), active.jobId);
    if (active.ttlSec) await redis.expire(key({ queue, groupId, suffix: "active" }), active.ttlSec);
  }
  if (attempt) await redis.set(key({ queue, groupId, suffix: "attempt" }), attempt);
  if (error) await redis.hset(key({ queue, groupId, suffix: "error" }), error);
}

async function seedQueue(redis: Redis): Promise<void> {
  const queue = "{qa}";
  await seedGroup({
    redis,
    queue,
    groupId: "g1",
    ready: 10,
    jobs: [
      ["j1", 100],
      ["j2", 200],
    ],
  });
  await seedGroup({
    redis,
    queue,
    groupId: "g2",
    ready: 20,
    jobs: [["j3", 300]],
    active: { jobId: "j3", ttlSec: 30 },
    attempt: "3",
  });
  await seedGroup({ redis, queue, groupId: "g3", ready: 30, jobs: [["j4", 400]], withData: false });
  await seedGroup({
    redis,
    queue,
    groupId: "g4",
    ready: 40,
    jobs: [["j5", 500]],
    blocked: true,
    error: { message: "boom", stack: "at x", timestamp: "123.5" },
  });
  await seedGroup({ redis, queue, groupId: "g5", ready: 50, active: { jobId: "jx" } });
  await seedGroup({ redis, queue, groupId: "b1", blocked: true, error: { message: "stale" } });
  await seedGroup({ redis, queue, groupId: "b2", blocked: true, jobs: [["j6", 600]] });
  await redis.sadd(`${queue}:gq:dlq`, "d1", "d2");
  await redis.sadd(`${queue}:gq:parked-tenants`, "t1", "t2");
  await redis.zadd(`${queue}:gq:parked:t1`, 1, "p1", 2, "p2");
  await redis.zadd(`${queue}:gq:parked:t2`, 1, "p3");
}

const scan = async ({
  redis,
  queueNames,
  topN,
}: {
  redis: Redis;
  queueNames: string[];
  topN: number;
}) => QueueRedisRepository.create({ redis }).scanQueues({ queueNames, topN });

describe("QueueRedisRepository.scanQueues — characterization", () => {
  it("summarises ready, blocked, parked and dlq state with per-group detail", async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    await seedQueue(redis);
    expect(await scan({ redis, queueNames: ["{qa}"], topN: 10 })).toMatchSnapshot();
  });

  it("samples a limited page from both ends and caps the blocked sample", async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    await seedQueue(redis);
    expect(await scan({ redis, queueNames: ["{qa}"], topN: 2 })).toMatchSnapshot();
  });

  it("reads the published total-pending counter when present, clamping negatives", async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    await seedQueue(redis);
    await redis.set("{qa}:gq:stats:total-pending", "42");
    await seedGroup({ redis, queue: "qb", groupId: "n1", ready: 1, jobs: [["k", 1]] });
    await redis.set("qb:gq:stats:total-pending", "-5");
    expect(await scan({ redis, queueNames: ["{qa}", "qb"], topN: 10 })).toMatchSnapshot();
  });

  it("answers an empty summary for a queue with no keys", async () => {
    const redis = memoryRedisDouble({ store: memoryRedisStore() });
    expect(await scan({ redis, queueNames: ["qempty"], topN: 10 })).toMatchSnapshot();
  });
});
