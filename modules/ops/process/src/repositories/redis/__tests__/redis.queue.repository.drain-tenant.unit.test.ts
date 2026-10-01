import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const QUEUE = "drain";
const GROUPS = [
  "tenant-a/trace/1",
  "tenant-a/eval/2",
  "tenant-a/trace/3",
  "tenant-ab/trace/4",
  "tenant-b/trace/5",
  "other/tenant-a/6",
];
const JOBS: Record<string, number> = {
  "tenant-a/trace/1": 3,
  "tenant-a/eval/2": 1,
  "tenant-a/trace/3": 0,
  "tenant-ab/trace/4": 7,
  "tenant-b/trace/5": 2,
  "other/tenant-a/6": 9,
};

describe("QueueRedisRepository.drainTenant", () => {
  let evalsha: Mock<(...args: unknown[]) => Promise<unknown>>;
  let repo: QueueRedisRepository;

  beforeEach(async () => {
    const store = memoryRedisStore();
    evalsha = vi.fn(async (...args: unknown[]): Promise<unknown> => {
      const groupId = String(args.at(-1));
      if (groupId === "tenant-a/trace/3") throw new Error("script failed");
      return JOBS[groupId];
    });
    const redis = memoryRedisDouble({ store, script: { evalsha } });
    for (const [index, groupId] of GROUPS.entries()) {
      await redis.zadd(`${QUEUE}:gq:ready`, index, groupId);
    }
    repo = QueueRedisRepository.create({ redis });
  });

  const drainedGroups = () =>
    evalsha.mock.calls
      .map((args: unknown[]) => String(args.at(-1)))
      .toSorted((a, b) => String(a).localeCompare(String(b)));

  it.each([
    [{ tenantId: "tenant-a" }, ["tenant-a/eval/2", "tenant-a/trace/1", "tenant-a/trace/3"], 2, 4],
    [
      { tenantId: "tenant-a", groupIdContains: "trace" },
      ["tenant-a/trace/1", "tenant-a/trace/3"],
      1,
      3,
    ],
    [{ tenantId: "tenant-ab" }, ["tenant-ab/trace/4"], 1, 7],
    [{ tenantId: "tenant-a", groupIdContains: "nothing" }, [], 0, 0],
    [{ tenantId: "missing" }, [], 0, 0],
  ])(
    "drains %j: exactly the tenant's matching groups, counting only the drains that succeeded",
    async (filters, expectedGroups, groupsDrained, jobsDrained) => {
      const result = await repo.drainTenant({ queueName: QUEUE, ...filters });

      expect(drainedGroups()).toEqual(expectedGroups);
      expect(result).toEqual({ groupsDrained, jobsDrained });
    },
  );
});
