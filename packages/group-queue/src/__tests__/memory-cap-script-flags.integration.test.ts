import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts.ts";

/**
 * Drives the real scripts against a real Redis pushed over its memory cap
 * (specs/memory-cap-script-flags.feature). The cap is lowered only around the
 * call under test and always restored, since the Redis may be shared.
 */
let redis: Redis;
let original: { maxmemory: string; policy: string };
const QUEUE_NAME = "{test/memory-cap-script-flags}";
const PREFIX = `${QUEUE_NAME}:gq:`;

function stageJob({ stagedJobId }: { stagedJobId: string }) {
  return {
    stagedJobId,
    groupId: "g1",
    dispatchAfterMs: 1_000,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ stagedJobId }),
  };
}

async function readConfig({ name }: { name: string }): Promise<string> {
  const reply = await redis.config("GET", name);
  return String(reply[1]);
}

async function overMemoryCap<Result>(operation: () => Promise<Result>): Promise<Result> {
  // noeviction first: under an evicting policy a 1-byte cap would empty the server.
  await redis.config("SET", "maxmemory-policy", "noeviction");
  await redis.config("SET", "maxmemory", "1");
  try {
    return await operation();
  } finally {
    await redis.config("SET", "maxmemory", original.maxmemory);
    await redis.config("SET", "maxmemory-policy", original.policy);
  }
}

async function suiteKeys(): Promise<string[]> {
  return (await redis.keys(`${QUEUE_NAME}*`)).toSorted();
}

async function snapshotSuiteKeys(): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  for (const key of await suiteKeys()) {
    const dumped = await redis.dumpBuffer(key);
    snapshot.set(key, dumped ? dumped.toString("base64") : "");
  }
  return snapshot;
}

async function deleteSuiteKeys(): Promise<void> {
  const keys = await suiteKeys();
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
  original = {
    maxmemory: await readConfig({ name: "maxmemory" }),
    policy: await readConfig({ name: "maxmemory-policy" }),
  };
});

beforeEach(async () => {
  await deleteSuiteKeys();
});

afterAll(async () => {
  await redis.config("SET", "maxmemory", original.maxmemory);
  await redis.config("SET", "maxmemory-policy", original.policy);
  await deleteSuiteKeys();
  await redis.quit();
});

describe("Queue scripts at the Redis memory cap", () => {
  describe("given a group already holding one staged job", () => {
    describe("when a second job is staged while memory is over the cap", () => {
      /** @scenario "At the memory cap a staging script is refused whole and leaves nothing behind" */
      it("refuses the stage and leaves every queue key as it was", async () => {
        const scripts = new GroupStagingScripts(redis, QUEUE_NAME);
        await scripts.stage(stageJob({ stagedJobId: "j1" }));
        const before = await snapshotSuiteKeys();

        await expect(
          overMemoryCap(() => scripts.stage(stageJob({ stagedJobId: "j2" }))),
        ).rejects.toThrow(/OOM/);

        expect(await snapshotSuiteKeys()).toEqual(before);
        expect(await redis.zrange(`${PREFIX}group:g1:jobs`, 0, -1)).toEqual(["j1"]);
      });
    });
  });

  describe("given a group holding one staged job", () => {
    describe("when a worker claims and completes it while memory is over the cap", () => {
      /** @scenario "At the memory cap a job is still claimed and completed, freeing its keys" */
      it("claims and completes the job and removes the group's keys", async () => {
        const scripts = new GroupStagingScripts(redis, QUEUE_NAME);
        await scripts.stage(stageJob({ stagedJobId: "j1" }));

        const { claimed, completed } = await overMemoryCap(async () => {
          const dispatched = await scripts.dispatch({ nowMs: 2_000, activeTtlSec: 60 });
          const done = dispatched
            ? await scripts.complete({
                groupId: "g1",
                stagedJobId: dispatched.stagedJobId,
                claimToken: dispatched.claimToken,
              })
            : false;
          return { claimed: dispatched?.stagedJobId, completed: done };
        });

        expect(claimed).toBe("j1");
        expect(completed).toBe(true);
        const groupKeys = ["jobs", "data", "active", "claimed"].map(
          (suffix) => `${PREFIX}group:g1:${suffix}`,
        );
        expect(await redis.exists(...groupKeys)).toBe(0);
      });
    });
  });
});
