import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BLOB_BACKSTOP_TTL_SECONDS, BLOB_RELEASE_GRACE_TTL_SECONDS } from "../blobConstants";
import { BlobLeases } from "../blobLeases";
import { GroupStagingScripts } from "../scripts";
import { createTenantId } from "../storage";

/**
 * GQ2 blob leases move INSIDE the stage eval, atomic with the squash that
 * displaces the value they guard. The old post-eval fire-and-forget transfer
 * could reorder against a concurrent squash of the same dedup id and leave a
 * phantom lifecycle entry pinning the blob until its TTL — the 2026-07-09 leak.
 */
let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/blob-hardening}";
const TENANT = "project-x";
const GROUP = `${TENANT}/group-1`;

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

function makeJob(overrides: Partial<Parameters<typeof scripts.stage>[0]> = {}) {
  return {
    stagedJobId: `job-${crypto.randomUUID().slice(0, 8)}`,
    groupId: GROUP,
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
  tier = "redis",
  projectId = TENANT,
}: {
  hash: string;
  token: string;
  tier?: "redis" | "s3";
  projectId?: string;
}): string {
  const header = JSON.stringify({
    v: 2,
    e: tier,
    ref: { tier, projectId, hash },
    h: token,
  });
  return `GQ2|${Buffer.byteLength(header)}|${header}`;
}

const leaseKey = ({ hash, projectId = TENANT }: { hash: string; projectId?: string }) =>
  `${keyPrefix()}blobleases:${projectId}/${hash}`;

const blobKey = ({ hash, projectId = TENANT }: { hash: string; projectId?: string }) =>
  `${keyPrefix()}blob:${projectId}/${hash}`;

/** Simulates the producer's blob write plus lease take for a staged value. */
async function seedBlobAndLease({ hash, token }: { hash: string; token: string }) {
  await redis.set(blobKey({ hash }), "gzipped-bytes");
  await redis.zadd(leaseKey({ hash }), Date.now() + 60_000, token);
}

async function releaseLease({ hash, holderId }: { hash: string; holderId: string }) {
  await new BlobLeases({ redis, queueName: QUEUE_NAME }).release({
    projectId: createTenantId(TENANT),
    hash,
    holderId,
    tier: "redis",
  });
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
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("GroupStagingScripts — GQ2 blob lease hardening", () => {
  describe("given two sibling jobs staged on one content-addressed blob", () => {
    // The production incident (missing_blob, hundreds an hour over seven days).
    // Sibling subscribers folding the same trace encode identical payloads, so
    // they hash to ONE blob. Under the holder scheme the refcount member was
    // added in a round trip AFTER stage() returned, so a sibling completing in
    // that window saw a zero refcount and unlinked the blob out from under a
    // job that was already staged. The survivor then failed to decode and was
    // dropped permanently.
    /** @scenario A sibling completing never strips a co-staged job's blob */
    it("keeps the blob readable for the surviving sibling after the first completes", async () => {
      const SHARED = "h-shared";
      // Both siblings carry the same ref but their own per-stage hold token,
      // exactly as encodeJobEnvelope mints them.
      await redis.set(blobKey({ hash: SHARED }), "gzipped-bytes");

      const stagedA = await scripts.stage(
        makeJob({ stagedJobId: "j-a", jobDataJson: gq2Value({ hash: SHARED, token: "t-a" }) }),
      );
      const stagedB = await scripts.stage(
        makeJob({
          stagedJobId: "j-b",
          groupId: `${TENANT}/group-2`,
          jobDataJson: gq2Value({ hash: SHARED, token: "t-b" }),
        }),
      );

      expect(stagedA.isNew).toBe(true);
      expect(stagedB.isNew).toBe(true);

      // No acquire window: staging published both leases itself, so neither
      // job was ever dispatchable while unreferenced.
      expect((await redis.zrange(leaseKey({ hash: SHARED }), 0, -1)).sort()).toEqual([
        "t-a",
        "t-b",
      ]);

      await releaseLease({ hash: SHARED, holderId: "t-a" });

      // B is still staged and still leases the blob — the bytes must live.
      expect(await redis.zrange(leaseKey({ hash: SHARED }), 0, -1)).toEqual(["t-b"]);
      expect(await redis.get(blobKey({ hash: SHARED }))).toBe("gzipped-bytes");
    });

    /** @scenario A sibling completing never strips a co-staged job's blob */
    it("keeps the blob when the last lease is released, moving it onto the grace window", async () => {
      const SHARED = "h-last";
      await redis.set(blobKey({ hash: SHARED }), "gzipped-bytes", "EX", BLOB_BACKSTOP_TTL_SECONDS);
      await scripts.stage(
        makeJob({
          stagedJobId: "j-only",
          jobDataJson: gq2Value({ hash: SHARED, token: "t-only" }),
        }),
      );

      await releaseLease({ hash: SHARED, holderId: "t-only" });

      // Emptying the lease set drops the set, never the payload: a concurrent
      // producer may already have re-staged this content. The deadline shortens
      // so an unread blob does not hold Redis for days.
      expect(await redis.zrange(leaseKey({ hash: SHARED }), 0, -1)).toEqual([]);
      expect(await redis.exists(blobKey({ hash: SHARED }))).toBe(1);
      expect(await redis.ttl(blobKey({ hash: SHARED }))).toBeLessThanOrEqual(
        BLOB_RELEASE_GRACE_TTL_SECONDS,
      );
    });
  });

  describe("when a replace squash displaces a staged GQ2 value", () => {
    /** @scenario A dedup squash leaves no phantom lease and never eagerly reclaims blobs */
    it("takes the replacement lease, drops the displaced one, and leaves reclaim lazy", async () => {
      const oldValue = gq2Value({ hash: "h1", token: "t1" });
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          dedupId: "hold-replace",
          dedupTtlMs: 60000,
          jobDataJson: oldValue,
        }),
      );
      await seedBlobAndLease({ hash: "h1", token: "t1" });
      await redis.set(blobKey({ hash: "h2" }), "gzipped-bytes");

      const { isNew, orphanedValue } = await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          dedupId: "hold-replace",
          dedupTtlMs: 60000,
          jobDataJson: gq2Value({ hash: "h2", token: "t2" }),
        }),
      );

      expect(isNew).toBe(false);
      expect(orphanedValue).toBe(oldValue);
      expect(await redis.zrange(leaseKey({ hash: "h2" }), 0, -1)).toEqual(["t2"]);
      expect(await redis.ttl(leaseKey({ hash: "h2" }))).toBeGreaterThan(0);
      expect(await redis.exists(leaseKey({ hash: "h1" }))).toBe(0);
      // Lazy reclaim: the displaced bytes stay for the sweeper, never unlinked
      // by the squash itself.
      expect(await redis.exists(blobKey({ hash: "h1" }))).toBe(1);
    });

    // The squash release must grant the same grace window the standalone
    // release eval does, or a displaced blob occupies Redis for the full
    // backstop.
    /** @scenario A dedup squash that retires the last lease puts the displaced blob on the grace window */
    it("shortens a displaced blob's expiry when nothing leases it", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          dedupId: "hold-grace",
          dedupTtlMs: 60000,
          jobDataJson: gq2Value({ hash: "h-grace", token: "t1" }),
        }),
      );
      for (const hash of ["h-grace", "h-grace-new"]) {
        await redis.set(blobKey({ hash }), "gzipped-bytes", "EX", BLOB_BACKSTOP_TTL_SECONDS);
      }

      await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          dedupId: "hold-grace",
          dedupTtlMs: 60000,
          jobDataJson: gq2Value({ hash: "h-grace-new", token: "t2" }),
        }),
      );

      expect(await redis.exists(blobKey({ hash: "h-grace" }))).toBe(1);
      expect(await redis.ttl(blobKey({ hash: "h-grace" }))).toBeLessThanOrEqual(
        BLOB_RELEASE_GRACE_TTL_SECONDS,
      );
      // The blob the replacement actually leases keeps its full backstop.
      expect(await redis.ttl(blobKey({ hash: "h-grace-new" }))).toBeGreaterThan(
        BLOB_RELEASE_GRACE_TTL_SECONDS,
      );
    });
  });

  describe("when a job is squashed twice in succession", () => {
    /** @scenario A squash chain never leaves a phantom lease */
    it("leaves only the final lease and no eager blob deletions", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          dedupId: "hold-chain",
          dedupTtlMs: 60000,
          jobDataJson: gq2Value({ hash: "h1", token: "t1" }),
        }),
      );
      await seedBlobAndLease({ hash: "h1", token: "t1" });

      for (const [hash, token] of [
        ["h2", "t2"],
        ["h3", "t3"],
      ] as const) {
        await redis.set(blobKey({ hash }), "gzipped-bytes");
        await scripts.stage(
          makeJob({
            stagedJobId: `j-${hash}`,
            dedupId: "hold-chain",
            dedupTtlMs: 60000,
            jobDataJson: gq2Value({ hash, token }),
          }),
        );
      }

      expect(await redis.zrange(leaseKey({ hash: "h3" }), 0, -1)).toEqual(["t3"]);
      expect(await redis.exists(leaseKey({ hash: "h1" }))).toBe(0);
      expect(await redis.exists(leaseKey({ hash: "h2" }))).toBe(0);
      expect(await redis.exists(blobKey({ hash: "h1" }))).toBe(1);
      expect(await redis.exists(blobKey({ hash: "h2" }))).toBe(1);
      expect(await redis.exists(blobKey({ hash: "h3" }))).toBe(1);
    });
  });

  describe("when the squash keeps the stored payload", () => {
    /** @scenario A squash that keeps the stored payload takes no lease for the discarded value */
    it("leaves the stored lease untouched and records none for the discarded value", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          dedupId: "hold-keep",
          dedupTtlMs: 60000,
          jobDataJson: gq2Value({ hash: "h-kept", token: "t-kept" }),
          shouldExtend: false,
          shouldReplace: false,
        }),
      );
      await seedBlobAndLease({ hash: "h-kept", token: "t-kept" });

      const discarded = gq2Value({ hash: "h-disc", token: "t-disc" });
      const { orphanedValue } = await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          dedupId: "hold-keep",
          dedupTtlMs: 60000,
          jobDataJson: discarded,
          shouldExtend: false,
          shouldReplace: false,
        }),
      );

      // The discarded value was never staged: no lease may exist for it.
      expect(orphanedValue).toBe(discarded);
      expect(await redis.zrange(leaseKey({ hash: "h-kept" }), 0, -1)).toEqual(["t-kept"]);
      expect(await redis.exists(leaseKey({ hash: "h-disc" }))).toBe(0);
    });
  });

  describe("when a survive-dispatch squash hits an already-dispatched dedup", () => {
    /** @scenario A post-dispatch survive-dispatch squash takes no lease for the discarded value */
    it("records no lease for the discarded value", async () => {
      await scripts.stage(
        makeJob({
          stagedJobId: "j1",
          dedupId: "hold-survive",
          dedupTtlMs: 60000,
          dispatchAfterMs: 0,
          jobDataJson: gq2Value({ hash: "h1", token: "t1" }),
          shouldSurviveDispatch: true,
        }),
      );
      const dispatched = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 30 });
      expect(dispatched?.stagedJobId).toBe("j1");

      const late = gq2Value({ hash: "h-late", token: "t-late" });
      const { isNew, orphanedValue } = await scripts.stage(
        makeJob({
          stagedJobId: "j2",
          dedupId: "hold-survive",
          dedupTtlMs: 60000,
          jobDataJson: late,
          shouldSurviveDispatch: true,
        }),
      );

      expect(isNew).toBe(false);
      expect(orphanedValue).toBe(late);
      expect(await redis.exists(leaseKey({ hash: "h-late" }))).toBe(0);
    });
  });
});
