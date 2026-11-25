import {
  type MemoryRedisStore,
  memoryRedisDouble,
  memoryRedisStore,
} from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const QUEUE_NAME = "test-queue";
const PREFIX = `${QUEUE_NAME}:gq:`;

function stageGroup({
  store,
  groupId,
  readyScore,
  headJobScore,
  headJobId,
}: {
  store: MemoryRedisStore;
  groupId: string;
  readyScore: number;
  headJobScore: number;
  headJobId: string;
}): void {
  const ready = store.sortedSets.get(`${PREFIX}ready`) ?? new Map<string, number>();
  store.sortedSets.set(`${PREFIX}ready`, ready.set(groupId, readyScore));
  store.sortedSets.set(`${PREFIX}group:${groupId}:jobs`, new Map([[headJobId, headJobScore]]));
}

async function scan({ store, topN }: { store: MemoryRedisStore; topN: number }) {
  const repo = QueueRedisRepository.create({ redis: memoryRedisDouble({ store }) });
  const queues = await repo.scanQueues({ queueNames: [QUEUE_NAME], topN });
  return queues[0]!;
}

describe("QueueRedisRepository.scanQueues — group summary", () => {
  describe("given more ready groups than the scan limit", () => {
    describe("when the queue is scanned", () => {
      it("samples both ends, so the most-eligible and most-deferred groups are listed", async () => {
        const store = memoryRedisStore();
        const now = Date.now();
        // Ascending eligibility: oldest-due first, most-deferred last.
        stageGroup({
          store,
          groupId: "group-eligible-old",
          readyScore: now - 86_400_000,
          headJobScore: now - 86_400_000,
          headJobId: "job-a",
        });
        stageGroup({
          store,
          groupId: "group-mid-1",
          readyScore: now - 5_000,
          headJobScore: now - 5_000,
          headJobId: "job-b",
        });
        stageGroup({
          store,
          groupId: "group-mid-2",
          readyScore: now - 1_000,
          headJobScore: now - 1_000,
          headJobId: "job-c",
        });
        // Deferred group models a group whose ready score sits far in the
        // future (retry backoff / delayed stage) while its head job's
        // ORIGINAL due time (preserved across retries) is already overdue.
        stageGroup({
          store,
          groupId: "group-deferred",
          readyScore: now + 300_000,
          headJobScore: now - 60_000,
          headJobId: "job-d",
        });

        const queue = await scan({ store, topN: 1 });

        const listed = queue.groups.map((g) => g.groupId);
        expect(listed).toContain("group-eligible-old");
        expect(listed).toContain("group-deferred");
      });
    });
  });

  describe("given a head job that retried since ADR-080", () => {
    describe("when the queue is scanned", () => {
      it("reads the retry count from the group's attempt key, not the job id", async () => {
        const store = memoryRedisStore();
        stageGroup({
          store,
          groupId: "group-retrying",
          readyScore: Date.now() + 60_000,
          headJobScore: Date.now() + 60_000,
          headJobId: "evt-plain-id",
        });
        store.strings.set(`${PREFIX}group:group-retrying:attempt`, "4");

        const queue = await scan({ store, topN: 10 });

        const group = queue.groups.find((g) => g.groupId === "group-retrying");
        expect(group?.retryCount).toBe(4);
      });
    });
  });

  describe("given only a legacy retry marker in the job id", () => {
    describe("when the queue is scanned", () => {
      it("does not infer a retry count without the canonical attempt key", async () => {
        const store = memoryRedisStore();
        stageGroup({
          store,
          groupId: "group-legacy",
          readyScore: Date.now(),
          headJobScore: Date.now(),
          headJobId: "evt-1/r/2",
        });

        const queue = await scan({ store, topN: 10 });

        const group = queue.groups.find((g) => g.groupId === "group-legacy");
        expect(group?.retryCount).toBeNull();
      });
    });
  });

  describe("given a head job that never retried", () => {
    describe("when the queue is scanned", () => {
      it("reports no retry count", async () => {
        const store = memoryRedisStore();
        stageGroup({
          store,
          groupId: "group-fresh",
          readyScore: Date.now(),
          headJobScore: Date.now(),
          headJobId: "evt-fresh",
        });

        const queue = await scan({ store, topN: 10 });

        const group = queue.groups.find((g) => g.groupId === "group-fresh");
        expect(group?.retryCount).toBeNull();
      });
    });
  });
});
