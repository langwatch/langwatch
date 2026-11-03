import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupBatchEntry, GroupQueueRuntimeDefinition, JobDelivery } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

type TestPayload = {
  id: string;
  groupId: string;
  value: number;
  __pipelineName: string;
  __jobType: string;
  __jobName: string;
};

const ROUTE = { pipelineName: "trace_processing", jobType: "projection", jobName: "traceSummary" };
const SCORE_BASE_MS = Date.now() - 60 * 60 * 1000;
const WAIT = { timeout: 30_000, interval: 50 };

function payloadsFor({
  groupIds,
  jobsPerGroup,
}: {
  groupIds: string[];
  jobsPerGroup: number;
}): TestPayload[] {
  return groupIds.flatMap((groupId) =>
    Array.from({ length: jobsPerGroup }, (_, value) => ({
      id: `${groupId}#${value}`,
      groupId,
      value,
      __pipelineName: ROUTE.pipelineName,
      __jobType: ROUTE.jobType,
      __jobName: ROUTE.jobName,
    })),
  );
}

const groupsOf = (tenant: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${tenant}/fold/traceSummary/trace:${index}`);

const payloadsIn = (calls: GroupBatchEntry<TestPayload>[][]) =>
  calls.flat().flatMap((group) => group.payloads);

const groupOf = (group: GroupBatchEntry<TestPayload>) => group.payloads[0]?.groupId ?? "";

const tenantOf = (group: GroupBatchEntry<TestPayload>) => groupOf(group).split("/")[0];

/** Appends to a per-group list, the shape every ordering assertion reads. */
function appendTo<V>(seen: Map<string, V[]>, groupId: string, value: V): void {
  const list = seen.get(groupId);
  if (list) list.push(value);
  else seen.set(groupId, [value]);
}

/** A queue per test on its own key prefix; `batching: false` is a worker that runs groups alone. */
function queueHarness() {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[] = [];
  let queueName = "";

  beforeAll(() => {
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });
  beforeEach(() => {
    queues = [];
    queueName = `{test/cross-group/${crypto.randomUUID().slice(0, 8)}}`;
  });
  afterEach(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => {})));
    const keys = await redis.keys("{test/cross-group/*");
    if (keys.length > 0) await redis.del(...keys);
  });
  afterAll(async () => {
    await redis.quit();
  });

  return {
    redis: () => redis,
    groupKey: (groupId: string, suffix: string) => `${queueName}:gq:group:${groupId}:${suffix}`,
    createQueue({
      processGroups,
      process = async () => {},
      batching = true,
    }: {
      processGroups?: (groups: GroupBatchEntry<TestPayload>[]) => Promise<void>;
      process?: GroupQueueRuntimeDefinition<TestPayload>["process"];
      batching?: boolean;
    }): GroupQueueProcessor<TestPayload> {
      const groupBatching =
        batching && processGroups ? { processGroups, groupBatchRoutes: () => [ROUTE] } : {};
      const queue = new GroupQueueProcessor<TestPayload>(
        {
          name: queueName,
          groupKey: (payload) => payload.groupId,
          identify: (payload) => payload.id,
          score: (payload) => SCORE_BASE_MS + payload.value * 1000,
          process,
          processBatch: async (payloads, delivery) => {
            for (const payload of payloads) await process(payload, delivery);
          },
          coalesceMaxBatch: () => 50,
          ...groupBatching,
        },
        redis,
      );
      queues.push(queue);
      return queue;
    },
  };
}

describe("given ready groups of one handler and one tenant", () => {
  const harness = queueHarness();
  let calls: GroupBatchEntry<TestPayload>[][];
  let queue: GroupQueueProcessor<TestPayload>;

  beforeEach(async () => {
    calls = [];
    queue = harness.createQueue({
      processGroups: async (groups) => {
        calls.push(groups);
      },
    });
    await queue.waitUntilReady();
  });

  /** @scenario "Sixteen ready groups of one handler run as one call" */
  it("runs sixteen groups in one call and completes every group", async () => {
    await queue.sendBatch(payloadsFor({ groupIds: groupsOf("tenant-a", 16), jobsPerGroup: 3 }));

    await vi.waitFor(() => expect(payloadsIn(calls)).toHaveLength(48), WAIT);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(16);
  });

  /** @scenario "Order inside each group is kept" */
  it("hands each group's payloads over in queue order, with the group's own job ids", async () => {
    const payloads = payloadsFor({ groupIds: groupsOf("tenant-a", 4), jobsPerGroup: 5 });
    await queue.sendBatch(payloads.toSorted((a, b) => b.value - a.value));

    await vi.waitFor(() => expect(payloadsIn(calls)).toHaveLength(20), WAIT);
    for (const group of calls.flat()) {
      expect(group.payloads.map((payload) => payload.value)).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(group.payloads.map((payload) => payload.groupId)).size).toBe(1);
      expect(group.delivery.jobIds).toHaveLength(5);
    }
  });

  /** @scenario "Groups of different tenants never share a call" */
  it("never puts two tenants' groups in one call", async () => {
    const groupIds = [...groupsOf("tenant-a", 6), ...groupsOf("tenant-b", 6)];
    await queue.sendBatch(payloadsFor({ groupIds, jobsPerGroup: 2 }));

    await vi.waitFor(() => expect(payloadsIn(calls)).toHaveLength(24), WAIT);
    for (const call of calls) expect(new Set(call.map(tenantOf)).size).toBe(1);
  });
});

describe("given sixteen ready groups of which one fails on its first attempt", () => {
  const harness = queueHarness();

  /** @scenario "A failing group in a claimed batch is retried while the rest complete" */
  it("completes the other fifteen and retries the failing group on its own", async () => {
    const failing = groupsOf("tenant-a", 16)[5];
    const done = new Map<string, number[]>();
    const process = async (payload: TestPayload, delivery?: JobDelivery) => {
      const attempt = delivery?.attempt ?? 1;
      if (payload.groupId === failing && attempt === 1) throw new Error("poison group");
      appendTo(done, payload.groupId, attempt);
    };
    const queue = harness.createQueue({
      process,
      processGroups: async (groups) => {
        for (const group of groups) {
          for (const payload of group.payloads) await process(payload, group.delivery);
        }
      },
    });
    await queue.waitUntilReady();

    await queue.sendBatch(payloadsFor({ groupIds: groupsOf("tenant-a", 16), jobsPerGroup: 2 }));

    await vi.waitFor(() => expect(done.size).toBe(16), WAIT);
    for (const [groupId, attempts] of done) {
      expect(attempts.at(-1)).toBe(groupId === failing ? 2 : 1);
    }
  });
});

describe("given a group in a running batch was recovered by another worker", () => {
  const harness = queueHarness();

  /** @scenario "A stale completion is fenced" */
  it("leaves the recovered group's new claim untouched and completes the rest", async () => {
    const groupIds = groupsOf("tenant-a", 4);
    const claimedKey = harness.groupKey(groupIds[2] ?? "", "claimed");
    let ran = false;
    const queue = harness.createQueue({
      processGroups: async () => {
        // Another worker's recovery re-claims the group while this call runs.
        await harness.redis().hset(claimedKey, "token", "another-worker");
        ran = true;
      },
    });
    await queue.waitUntilReady();

    await queue.sendBatch(payloadsFor({ groupIds, jobsPerGroup: 1 }));

    await vi.waitFor(async () => {
      expect(ran).toBe(true);
      const active = await Promise.all(
        groupIds.map((groupId) => harness.redis().exists(harness.groupKey(groupId, "active"))),
      );
      expect(active).toEqual([0, 0, 1, 0]);
    }, WAIT);
    expect(await harness.redis().hget(claimedKey, "token")).toBe("another-worker");
  });
});

describe("given a worker that runs every group alone beside one that batches groups", () => {
  const harness = queueHarness();

  /** @scenario "An old and a new worker drain one queue together" */
  it("runs every job exactly once and each group's jobs in order", async () => {
    const seen = new Map<string, number[]>();
    const process = async (payload: TestPayload) => appendTo(seen, payload.groupId, payload.value);
    const older = harness.createQueue({ process, batching: false });
    const newer = harness.createQueue({
      process,
      processGroups: async (groups) => {
        for (const payload of groups.flatMap((group) => group.payloads)) await process(payload);
      },
    });
    await Promise.all([older.waitUntilReady(), newer.waitUntilReady()]);

    const groupIds = groupsOf("tenant-a", 24);
    const payloads = payloadsFor({ groupIds, jobsPerGroup: 6 });
    for (let value = 0; value < 6; value += 1) {
      await newer.sendBatch(payloads.filter((payload) => payload.value === value));
    }

    const total = () => [...seen.values()].flat().length;
    await vi.waitFor(() => expect(total()).toBe(groupIds.length * 6), WAIT);
    for (const groupId of groupIds) expect(seen.get(groupId)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
