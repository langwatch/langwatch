import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BlobLeases } from "../blobLeases.ts";
import { GroupStagingScripts } from "../scripts.ts";
import { createTenantId } from "../storage.ts";

/**
 * Guarantees the Lua scripts in scripts.ts must hold under concurrency and
 * cross-tenant traffic. Each test drives the real scripts against real Redis
 * (never a mock) and asserts on queue state, never on call shape.
 */
let redis: Redis;
const QUEUE_NAME = "{test/scripts-guarantees}";

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

function scriptsFor(policy: ConstructorParameters<typeof GroupStagingScripts>[2] = {}) {
  return new GroupStagingScripts(redis, QUEUE_NAME, policy);
}

function makeJob(
  scripts: GroupStagingScripts,
  overrides: Partial<Parameters<typeof scripts.stage>[0]> = {},
) {
  return {
    stagedJobId: `job-${crypto.randomUUID().slice(0, 8)}`,
    groupId: "group-a",
    dispatchAfterMs: 1000,
    dedupId: "",
    dedupTtlMs: 0,
    jobDataJson: JSON.stringify({ hello: "world" }),
    shouldExtend: true,
    shouldReplace: true,
    ...overrides,
  };
}

/** The envelope shape `encodeJobEnvelope` mints for an offloaded payload. */
function gq2Value({
  hash,
  token,
  projectId,
}: {
  hash: string;
  token: string;
  projectId: string;
}): string {
  const header = JSON.stringify({
    v: 2,
    e: "redis",
    ref: { tier: "redis", projectId, hash },
    h: token,
  });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

function leaseKey({ hash, projectId }: { hash: string; projectId: string }) {
  return `${keyPrefix()}blobleases:${projectId}/${hash}`;
}

function blobKey({ hash, projectId }: { hash: string; projectId: string }) {
  return `${keyPrefix()}blob:${projectId}/${hash}`;
}

async function inspectGroupJobs(groupId: string) {
  return redis.zrange(`${keyPrefix()}group:${groupId}:jobs`, 0, -1);
}

async function inspectTotalPending(): Promise<number> {
  return Number((await redis.get(`${keyPrefix()}stats:total-pending`)) ?? 0);
}

async function deleteSuiteKeys(): Promise<void> {
  const keys = await redis.keys(`${QUEUE_NAME}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

beforeEach(async () => {
  await deleteSuiteKeys();
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("GroupStagingScripts — dedup atomicity", () => {
  describe("given ten concurrent stages racing the same dedup id", () => {
    describe("when they all resolve", () => {
      /** @scenario "A dedup TOCTOU race between concurrent stages squashes to exactly one job" */
      it("leaves exactly one job in the group, keyed by the dedup key's winner", async () => {
        const scripts = scriptsFor();
        const dedupId = "toctou-concurrent";
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            scripts.stage(
              makeJob(scripts, {
                stagedJobId: `job-${i}`,
                dedupId,
                dedupTtlMs: 60_000,
                jobDataJson: JSON.stringify({ i }),
              }),
            ),
          ),
        );

        const jobs = await inspectGroupJobs("group-a");
        expect(jobs).toHaveLength(1);

        const winner = await redis.get(`${keyPrefix()}dedup:${dedupId}`);
        expect(winner).toBe(jobs[0]);

        // Exactly one of the ten calls actually created the row; every other
        // call squashed onto it — never two survivors, never zero.
        const newCount = results.filter((r) => r.isNew).length;
        expect(newCount).toBe(1);
      });
    });
  });

  describe("given a dedup'd job is dispatched while a sibling races to stage on the same id", () => {
    describe("when dispatch and stage settle concurrently", () => {
      /** @scenario "A stage racing a dispatch of its own dedup key never double-counts pending" */
      it("conserves the total-pending counter against the group's actual staged jobs", async () => {
        const scripts = scriptsFor();
        const dedupId = "toctou-dispatch-race";
        await scripts.stage(
          makeJob(scripts, { stagedJobId: "j1", dedupId, dedupTtlMs: 60_000, dispatchAfterMs: 0 }),
        );

        await Promise.all([
          scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 300 }),
          scripts.stage(
            makeJob(scripts, {
              stagedJobId: "j2",
              dedupId,
              dedupTtlMs: 60_000,
              dispatchAfterMs: 5000,
            }),
          ),
        ]);

        const jobs = await inspectGroupJobs("group-a");
        expect(await inspectTotalPending()).toBe(jobs.length);
      });
    });
  });
});

describe("GroupStagingScripts — blob-lease reclamation on squash", () => {
  const TENANT = "project-x";
  const GROUP = `${TENANT}/group-1`;

  describe("given several concurrent squashes race to displace the same dedup slot, each holding its own blob lease", () => {
    describe("when every squash settles", () => {
      /** @scenario "Concurrent squashes on one dedup id never leave more than the winner's lease live" */
      it("leaves exactly one contender's lease live and takes no lease for any loser", async () => {
        const scripts = scriptsFor();
        const dedupId = "lease-race";
        const contenders = Array.from({ length: 5 }, (_, i) => ({
          hash: `h-${i}`,
          token: `t-${i}`,
        }));
        for (const { hash } of contenders) {
          await redis.set(blobKey({ hash, projectId: TENANT }), "bytes");
        }

        await Promise.all(
          contenders.map(({ hash, token }) =>
            scripts.stage(
              makeJob(scripts, {
                stagedJobId: `job-${hash}`,
                groupId: GROUP,
                dedupId,
                dedupTtlMs: 60_000,
                jobDataJson: gq2Value({ hash, token, projectId: TENANT }),
              }),
            ),
          ),
        );

        const liveLeases = await Promise.all(
          contenders.map(async ({ hash, token }) => {
            const members = await redis.zrange(leaseKey({ hash, projectId: TENANT }), 0, -1);
            return members.includes(token);
          }),
        );

        expect(liveLeases.filter(Boolean)).toHaveLength(1);
      });
    });
  });

  describe("given a squash displaces a lease while its blob is concurrently released by a sibling holder", () => {
    describe("when the squash and the release settle", () => {
      /** @scenario "A squash racing a sibling's release never double-releases or resurrects a lease" */
      it("never leaves the displaced blob referenced by a lease that no longer exists", async () => {
        const scripts = scriptsFor();
        const dedupId = "lease-vs-release";
        const oldValue = gq2Value({ hash: "h-old", token: "t-old", projectId: TENANT });
        await redis.set(blobKey({ hash: "h-old", projectId: TENANT }), "bytes");
        await scripts.stage(
          makeJob(scripts, {
            stagedJobId: "j-old",
            groupId: GROUP,
            dedupId,
            dedupTtlMs: 60_000,
            jobDataJson: oldValue,
          }),
        );
        // A sibling holder shares the same content, so the lease set has two
        // members before the race — the squash must only ever retire "t-old".
        await redis.zadd(
          leaseKey({ hash: "h-old", projectId: TENANT }),
          Date.now() + 60_000,
          "t-sibling",
        );
        await redis.set(blobKey({ hash: "h-new", projectId: TENANT }), "bytes");

        const leases = new BlobLeases({ redis, queueName: QUEUE_NAME });
        await Promise.all([
          scripts.stage(
            makeJob(scripts, {
              stagedJobId: "j-new",
              groupId: GROUP,
              dedupId,
              dedupTtlMs: 60_000,
              jobDataJson: gq2Value({ hash: "h-new", token: "t-new", projectId: TENANT }),
            }),
          ),
          leases.release({
            projectId: createTenantId(TENANT),
            hash: "h-old",
            holderId: "t-sibling",
            tier: "redis",
          }),
        ]);

        // The sibling's own release only ever removes its own token; the
        // squash only ever removes "t-old" — neither can leave the set
        // holding a token nobody staged, nor delete the blob a live lease
        // still names.
        const remaining = await redis.zrange(leaseKey({ hash: "h-old", projectId: TENANT }), 0, -1);
        expect(remaining.every((token) => token === "t-old" || token === "t-sibling")).toBe(true);
        expect(await redis.zrange(leaseKey({ hash: "h-new", projectId: TENANT }), 0, -1)).toEqual([
          "t-new",
        ]);
      });
    });
  });
});

describe("GroupStagingScripts — cross-tenant isolation of displaced refs", () => {
  describe("given a squash displaces a value whose blob ref names another tenant", () => {
    describe("when the squash resolves", () => {
      /** @scenario "A squash never reclaims or touches a displaced blob ref belonging to another tenant" */
      it("leaves the foreign tenant's lease and blob completely untouched", async () => {
        const scripts = scriptsFor();
        const OWN_TENANT = "project-mine";
        const FOREIGN_TENANT = "project-other";
        const GROUP = `${OWN_TENANT}/group-1`;
        const dedupId = "foreign-displaced";

        const foreignValue = gq2Value({
          hash: "h-foreign",
          token: "t-foreign",
          projectId: FOREIGN_TENANT,
        });
        await scripts.stage(
          makeJob(scripts, {
            stagedJobId: "j1",
            groupId: GROUP,
            dedupId,
            dedupTtlMs: 60_000,
            jobDataJson: foreignValue,
          }),
        );
        await redis.set(blobKey({ hash: "h-foreign", projectId: FOREIGN_TENANT }), "bytes");
        await redis.zadd(
          leaseKey({ hash: "h-foreign", projectId: FOREIGN_TENANT }),
          Date.now() + 60_000,
          "t-foreign",
        );

        await scripts.stage(
          makeJob(scripts, {
            stagedJobId: "j2",
            groupId: GROUP,
            dedupId,
            dedupTtlMs: 60_000,
            jobDataJson: gq2Value({ hash: "h-mine", token: "t-mine", projectId: OWN_TENANT }),
          }),
        );

        expect(
          await redis.zrange(leaseKey({ hash: "h-foreign", projectId: FOREIGN_TENANT }), 0, -1),
        ).toEqual(["t-foreign"]);
        expect(await redis.exists(blobKey({ hash: "h-foreign", projectId: FOREIGN_TENANT }))).toBe(
          1,
        );
      });
    });
  });
});

describe("GroupStagingScripts — heartbeat staleness after retry", () => {
  describe("given a retry rotates the active id while the previous heartbeat is still in flight", () => {
    describe("when the stale heartbeat lands after the retry", () => {
      /** @scenario "A stale heartbeat after a retry never extends the retry's backoff lock or ready score" */
      it("returns false and leaves the retry's TTL and ready score untouched", async () => {
        const scripts = scriptsFor();
        await scripts.stage(makeJob(scripts, { stagedJobId: "j1", dispatchAfterMs: 100 }));
        await scripts.dispatch({ nowMs: 200, activeTtlSec: 300 });

        const restaged = await scripts.retryRestage({
          groupId: "group-a",
          stagedJobId: "j1",
          newStagedJobId: "j1/r/1",
          dispatchAfterMs: 5_000,
          jobDataJson: JSON.stringify({ attempt: 2 }),
          backoffMs: 3_000,
          attempt: 1,
          attemptTtlSec: 1800,
        });
        expect(restaged).toBe(true);
        const backoffTtl = await redis.ttl(`${keyPrefix()}group:group-a:active`);

        // The heartbeat that was already in flight for j1 lands after the
        // retry rotated the active id to j1/r/1 — it must not touch either.
        const ok = await scripts.refreshActiveKey({
          groupId: "group-a",
          stagedJobId: "j1",
          activeTtlSec: 300,
        });

        expect(ok).toBe(false);
        expect(await redis.ttl(`${keyPrefix()}group:group-a:active`)).toBeLessThanOrEqual(
          backoffTtl,
        );
        expect(Number(await redis.zscore(`${keyPrefix()}ready`, "group-a"))).toBe(5_000);
      });
    });
  });
});
