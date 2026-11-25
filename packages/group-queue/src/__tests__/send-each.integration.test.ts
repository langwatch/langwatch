import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts, type StageBatchJob } from "../scripts.ts";

/**
 * A batch of single sends goes through the batch script; it must leave exactly the state the
 * same jobs staged one at a time leave. Two queues, one per path, compared field by field.
 * Spec: ../../specs/send-each.feature
 */
let redis: Redis;
const SINGLE = "{test/send-each-single}";
const BATCH = "{test/send-each-batch}";

const prefixOf = (queue: string) => `${queue}:gq:`;

function job(
  overrides: Partial<StageBatchJob> & Pick<StageBatchJob, "stagedJobId">,
): StageBatchJob {
  return {
    groupId: "proj_a/trace-1",
    dispatchAfterMs: 1000,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ id: overrides.stagedJobId }),
    shouldExtend: true,
    shouldReplace: true,
    shouldSurviveDispatch: false,
    ...overrides,
  };
}

/** The envelope `encodeJobEnvelope` mints for an offloaded body, holding a lease token. */
function blobValue({ hash, token }: { hash: string; token: string }): string {
  const header = JSON.stringify({
    v: 2,
    e: "redis",
    ref: { tier: "redis", projectId: "proj_a", hash },
    h: token,
  });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

/** Everything a stage writes, minus key TTLs, read the same way from either queue. */
async function stateOf({
  queue,
  groupIds,
  dedupIds,
  leaseHashes = [],
}: {
  queue: string;
  groupIds: readonly string[];
  dedupIds: readonly string[];
  leaseHashes?: readonly string[];
}) {
  const prefix = prefixOf(queue);
  const groups = await Promise.all(
    groupIds.map(async (groupId) => ({
      groupId,
      jobs: await redis.zrange(`${prefix}group:${groupId}:jobs`, 0, -1, "WITHSCORES"),
      data: await redis.hgetall(`${prefix}group:${groupId}:data`),
    })),
  );
  return {
    groups,
    dedup: await Promise.all(dedupIds.map((id) => redis.get(`${prefix}dedup:${id}`))),
    ready: await redis.zrange(`${prefix}ready`, 0, -1, "WITHSCORES"),
    pendingGroups: (await redis.smembers(`${prefix}pending-groups`)).toSorted(),
    totalPending: await redis.get(`${prefix}stats:total-pending`),
    leases: await Promise.all(
      leaseHashes.map((hash) => redis.zrange(`${prefix}blobleases:proj_a/${hash}`, 0, -1)),
    ),
  };
}

async function stageOneByOne(scripts: GroupStagingScripts, jobs: readonly StageBatchJob[]) {
  for (const each of jobs) await scripts.stage(each);
}

/** A job the dispatcher took: gone from its group and the counter, its dedup key left alive. */
async function dispatchedAway({ queue, each }: { queue: string; each: StageBatchJob }) {
  const prefix = prefixOf(queue);
  await redis.zrem(`${prefix}group:${each.groupId}:jobs`, each.stagedJobId);
  await redis.hdel(`${prefix}group:${each.groupId}:data`, each.stagedJobId);
  await redis.decr(`${prefix}stats:total-pending`);
}

async function deleteSuiteKeys(): Promise<void> {
  for (const queue of [SINGLE, BATCH]) {
    const keys = await redis.keys(`${queue}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
}

let single: GroupStagingScripts;
let batch: GroupStagingScripts;

beforeAll(() => {
  redis = new IORedis(
    process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    { maxRetriesPerRequest: 0 },
  );
});

beforeEach(async () => {
  await deleteSuiteKeys();
  single = new GroupStagingScripts(redis, SINGLE);
  batch = new GroupStagingScripts(redis, BATCH);
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("a batch of single sends against the same jobs staged one by one", () => {
  describe("given equal scores, a repeated staged id, repeated dedup ids and an offloaded body", () => {
    const jobs = [
      job({ stagedJobId: "j1", dedupId: "span-1", dedupTtlMs: 30_000 }),
      job({ stagedJobId: "j2", groupId: "proj_a/trace-2" }),
      job({ stagedJobId: "j3", dedupId: "span-1", dedupTtlMs: 30_000, dispatchAfterMs: 1500 }),
      job({ stagedJobId: "j2", groupId: "proj_a/trace-2", jobDataJson: '{"id":"j2-again"}' }),
      job({ stagedJobId: "j4", jobDataJson: blobValue({ hash: "h1", token: "lease-1" }) }),
    ];
    const read = (queue: string) =>
      stateOf({
        queue,
        groupIds: ["proj_a/trace-1", "proj_a/trace-2"],
        dedupIds: ["span-1"],
        leaseHashes: ["h1"],
      });

    /** @scenario A batch of single sends leaves the same queue state as the sends one by one */
    it("leaves the same jobs, scores, bodies, dedup keys, leases and pending count", async () => {
      await stageOneByOne(single, jobs);
      const { outcomes } = await batch.stageBatch(jobs);

      expect(await read(BATCH)).toEqual(await read(SINGLE));
      expect(outcomes).toEqual(["inserted", "inserted", "deduplicated", "updated", "inserted"]);
      expect((await read(BATCH)).totalPending).toBe("3");
    });
  });

  describe("given a staged job whose dedup id a later payload repeats", () => {
    const flagCombinations = [
      { shouldReplace: true, shouldExtend: true },
      { shouldReplace: true, shouldExtend: false },
      { shouldReplace: false, shouldExtend: true },
      { shouldReplace: false, shouldExtend: false },
    ];

    for (const flags of flagCombinations) {
      /** @scenario Every dedup flag behaves in a batch as it does for a single send */
      it(`keeps or replaces the body and score as a single send does (${JSON.stringify(flags)})`, async () => {
        const first = job({ stagedJobId: "first", dedupId: "d", dedupTtlMs: 30_000 });
        const later = job({
          stagedJobId: "later",
          dedupId: "d",
          dedupTtlMs: 30_000,
          dispatchAfterMs: 2000,
          jobDataJson: '{"id":"later"}',
          ...flags,
        });
        await single.stage(first);
        await batch.stage(first);

        await single.stage(later);
        const { outcomes } = await batch.stageBatch([later]);

        const read = (queue: string) =>
          stateOf({ queue, groupIds: [first.groupId], dedupIds: ["d"] });
        expect(await read(BATCH)).toEqual(await read(SINGLE));
        expect(outcomes).toEqual(["deduplicated"]);
      });
    }

    for (const shouldSurviveDispatch of [true, false]) {
      /** @scenario Every dedup flag behaves in a batch as it does for a single send */
      it(`squashes or restages a repeat after dispatch as a single send does (survive: ${shouldSurviveDispatch})`, async () => {
        const first = job({ stagedJobId: "first", dedupId: "d", dedupTtlMs: 30_000 });
        const later = job({
          stagedJobId: "later",
          dedupId: "d",
          dedupTtlMs: 30_000,
          shouldSurviveDispatch,
        });
        for (const [queue, scripts] of [
          [SINGLE, single],
          [BATCH, batch],
        ] as const) {
          await scripts.stage(first);
          await dispatchedAway({ queue, each: first });
        }

        await single.stage(later);
        const { outcomes } = await batch.stageBatch([later]);

        const read = (queue: string) =>
          stateOf({ queue, groupIds: [first.groupId], dedupIds: ["d"] });
        expect(await read(BATCH)).toEqual(await read(SINGLE));
        expect(outcomes).toEqual([shouldSurviveDispatch ? "deduplicated" : "inserted"]);
      });
    }
  });

  describe("given a group that is running and a group that is blocked", () => {
    /** @scenario A batch arriving at a running or blocked group leaves its ready score alone */
    it("lowers neither group's ready score, as a single send leaves it", async () => {
      const running = job({ stagedJobId: "r1", groupId: "proj_a/running" });
      const blocked = job({ stagedJobId: "b1", groupId: "proj_a/blocked" });
      for (const queue of [SINGLE, BATCH]) {
        const prefix = prefixOf(queue);
        await redis.set(`${prefix}group:proj_a/running:active`, "someone-else", "PX", 60_000);
        await redis.sadd(`${prefix}blocked`, "proj_a/blocked");
        await redis.zadd(`${prefix}ready`, 5000, "proj_a/running", 5000, "proj_a/blocked");
      }

      await stageOneByOne(single, [running, blocked]);
      await batch.stageBatch([running, blocked]);

      const read = (queue: string) =>
        stateOf({ queue, groupIds: ["proj_a/running", "proj_a/blocked"], dedupIds: [] });
      expect(await read(BATCH)).toEqual(await read(SINGLE));
      expect(await redis.zscore(`${prefixOf(BATCH)}ready`, "proj_a/running")).toBe("5000");
      expect(await redis.zscore(`${prefixOf(BATCH)}ready`, "proj_a/blocked")).toBe("5000");
    });
  });
});

describe("a batch of single sends whose reply was lost", () => {
  describe("given a batch Redis staged but whose answer never reached the producer", () => {
    /** @scenario A batch whose reply was lost is unknown and safe to send again */
    it("holds each job once when resent under the same staged ids", async () => {
      const jobs = [
        job({ stagedJobId: "a" }),
        job({ stagedJobId: "b", groupId: "proj_a/trace-2" }),
      ];
      await batch.stageBatch(jobs);
      const before = await stateOf({
        queue: BATCH,
        groupIds: ["proj_a/trace-1", "proj_a/trace-2"],
        dedupIds: [],
      });

      const { outcomes, newStagedCount } = await batch.stageBatch(jobs);

      expect(newStagedCount).toBe(0);
      expect(outcomes).toEqual(["updated", "updated"]);
      expect(
        await stateOf({
          queue: BATCH,
          groupIds: ["proj_a/trace-1", "proj_a/trace-2"],
          dedupIds: [],
        }),
      ).toEqual(before);
    });

    /** @scenario A batch whose reply was lost is unknown and safe to send again */
    it("folds a resend under fresh staged ids into the jobs its dedup ids already name", async () => {
      const sent = [
        job({ stagedJobId: "first-a", dedupId: "span-a", dedupTtlMs: 30_000 }),
        job({ stagedJobId: "first-b", dedupId: "span-b", dedupTtlMs: 30_000 }),
      ];
      await batch.stageBatch(sent);

      const resent = sent.map((each) => ({
        ...each,
        stagedJobId: each.stagedJobId.replace("first", "again"),
      }));
      const { outcomes } = await batch.stageBatch(resent);

      const state = await stateOf({
        queue: BATCH,
        groupIds: ["proj_a/trace-1"],
        dedupIds: ["span-a", "span-b"],
      });
      expect(outcomes).toEqual(["deduplicated", "deduplicated"]);
      expect(state.dedup).toEqual(["first-a", "first-b"]);
      expect(Object.keys(state.groups[0]?.data ?? {}).toSorted()).toEqual(["first-a", "first-b"]);
      expect(state.totalPending).toBe("2");
    });
  });
});
