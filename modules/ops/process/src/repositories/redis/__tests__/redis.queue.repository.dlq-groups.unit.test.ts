import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const PREFIX = "dlqq:gq:";
const envelope = (pipelineName: string): string => {
  const header = JSON.stringify({ v: 2, e: "j", p: pipelineName });
  return `GQ2|${header.length}|${header}{}`;
};
const key = (groupId: string, suffix: string) => `${PREFIX}dlq:${groupId}:${suffix}`;

/** A double whose prune script answers `pruned`, recording what it was asked to check. */
function dlqRedis({ pruned }: { pruned: string[] }) {
  const evalsha = vi.fn(async (..._args: unknown[]): Promise<unknown> => pruned);
  const redis = memoryRedisDouble({ store: memoryRedisStore(), script: { evalsha } });
  return { redis, evalsha };
}

describe("QueueRedisRepository.findDlqGroups", () => {
  it("lists every dead-lettered group with its error, head-job pipeline and job count, newest first", async () => {
    const { redis } = dlqRedis({ pruned: [] });
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

  describe("given an index member whose dead-letter entries have expired", () => {
    describe("when the groups are listed", () => {
      /** @scenario "Listing dead-letter groups forgets the ones whose entries expired" */
      it("asks the prune script to confirm only that member, naming all three of its keys", async () => {
        const { redis, evalsha } = dlqRedis({ pruned: ["g-expired"] });
        await redis.sadd(`${PREFIX}dlq`, "g-expired", "g-live");
        await redis.zadd(key("g-live", "jobs"), 1, "j1");

        await QueueRedisRepository.create({ redis }).findDlqGroups({ queueName: "dlqq" });

        expect(evalsha).toHaveBeenCalledTimes(1);
        expect(evalsha.mock.calls[0]!.slice(1)).toEqual([
          4,
          `${PREFIX}dlq`,
          key("g-expired", "jobs"),
          key("g-expired", "data"),
          key("g-expired", "error"),
          "g-expired",
        ]);
      });

      /** @scenario "Listing dead-letter groups forgets the ones whose entries expired" */
      it("leaves the pruned member out of the list", async () => {
        const { redis } = dlqRedis({ pruned: ["g-expired"] });
        await redis.sadd(`${PREFIX}dlq`, "g-expired", "g-live");
        await redis.zadd(key("g-live", "jobs"), 1, "j1");

        const groups = await QueueRedisRepository.create({ redis }).findDlqGroups({
          queueName: "dlqq",
        });

        expect(groups.map((group) => group.groupId)).toEqual(["g-live"]);
      });
    });
  });

  describe("given the prune script fails", () => {
    describe("when the groups are listed", () => {
      it("still lists every member", async () => {
        const evalsha = vi.fn(async (): Promise<unknown> => {
          throw new Error("script failed");
        });
        const redis = memoryRedisDouble({ store: memoryRedisStore(), script: { evalsha } });
        await redis.sadd(`${PREFIX}dlq`, "g-expired");

        const groups = await QueueRedisRepository.create({ redis }).findDlqGroups({
          queueName: "dlqq",
        });

        expect(groups.map((group) => group.groupId)).toEqual(["g-expired"]);
      });
    });
  });
});
