import { createTenantId } from "@langwatch/eventing";
import {
  blobHolderSetKey,
  blobLeaseSetKey,
  LEGACY_HOLDER_LEASE_GUARD,
  redisBlobKey,
} from "@langwatch/group-queue/operational";
import Redis, { type Redis as RedisClient } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  NoopSchedulerAuditSink,
  NoopSchedulerWakeService,
  PostgresOpsAdapter,
  type SchedulerOpsRepository,
} from "@langwatch/ops-server";
import type { OpsService } from "@langwatch/ops-contract";
import type { UserService } from "@langwatch/user-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectService } from "@langwatch/project-contract";

const redisUrl = process.env.REDIS_URL ?? process.env.CI_REDIS_URL;
const hasRedis = !!redisUrl;

const QUEUE = "{test/blobrepo}";
const PROJECT = "project-blobrepo";
const HASH = "blobrepohash01";

const schedulerRepository: SchedulerOpsRepository = {
  tryFindByIdForOps: async () => null,
  setActiveForOps: async () => false,
  releaseSlotForOps: async () => false,
  requestImmediateRunForOps: async () => false,
  listForOps: async () => [],
  listPausedForOps: async () => ({ rows: [], total: 0 }),
};

const projects: ProjectService = Object.create(ProjectService.prototype);
projects.listNamesByIds = async () => [];

/**
 * The operator delete path against a live Redis. The point under test is the
 * lease guard: it lives inside the delete script, so a job that acquires a
 * reference between "is it referenced?" and "delete it" is refused by the same
 * eval that would have removed the blob — the check-then-act race a Node-side
 * guard would leave open.
 */
describe.skipIf(!hasRedis)("Ops blob store delete", () => {
  let redis: RedisClient;
  let ops: OpsService;

  const tenant = createTenantId(PROJECT);
  const keyArgs = { queueName: QUEUE, projectId: tenant, hash: HASH };
  const blobKey = redisBlobKey(keyArgs);
  const leaseKey = blobLeaseSetKey(keyArgs);
  const holderKey = blobHolderSetKey(keyArgs);

  const nowMs = async () => {
    const [seconds, micros] = await redis.time();
    return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
  };

  const clearKeys = async () => {
    const keys = await redis.keys(`${QUEUE}*`);
    if (keys.length > 0) await redis.del(...keys);
  };

  beforeAll(async () => {
    if (!redisUrl) return;
    redis = new Redis(redisUrl);
    ops = PostgresOpsAdapter.create({
      database: {
        user: { findUnique: async () => null },
        session: { update: async () => ({}) },
      } as unknown as PrismaClient,
      adminEmails: [],
      audit: { record: async () => undefined },
      users: {} as UserService,
      redis,
      scheduler: {
        repository: schedulerRepository,
        audit: NoopSchedulerAuditSink.create(),
        wake: NoopSchedulerWakeService.create(),
        projects,
      },
    }).build();
  });

  afterEach(clearKeys);

  afterAll(async () => {
    await clearKeys();
    await redis?.quit();
  });

  describe("given a blob nothing references", () => {
    describe("when an operator deletes it", () => {
      it("removes the bytes and reports the delete", async () => {
        await redis.set(blobKey, "body", "EX", 3600);

        const result = await ops.deleteBlob({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
          requestedBy: "operator",
        });

        expect(result).toEqual({ deleted: true });
        expect(await redis.exists(blobKey)).toBe(0);
      });
    });
  });

  describe("given a blob a live lease still references", () => {
    describe("when an operator deletes it", () => {
      it("refuses atomically and leaves the bytes in place", async () => {
        await redis.set(blobKey, "body", "EX", 3600);
        // A live lease: a member whose deadline is in the future.
        await redis.zadd(leaseKey, (await nowMs()) + 60_000, "holder-a");
        await redis.sadd(holderKey, LEGACY_HOLDER_LEASE_GUARD, "holder-a");

        const result = await ops.deleteBlob({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
          requestedBy: "operator",
        });

        expect(result).toEqual({ deleted: false });
        expect(await redis.exists(blobKey)).toBe(1);
      });
    });
  });

  describe("given a blob whose only lease deadline has already lapsed", () => {
    describe("when an operator deletes it", () => {
      it("prunes the dead lease and deletes, because a lapsed member is not a reference", async () => {
        await redis.set(blobKey, "body", "EX", 3600);
        await redis.zadd(leaseKey, (await nowMs()) - 60_000, "holder-dead");

        const result = await ops.deleteBlob({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
          requestedBy: "operator",
        });

        expect(result).toEqual({ deleted: true });
        expect(await redis.exists(blobKey)).toBe(0);
      });
    });
  });

  describe("given a blob that has already expired", () => {
    describe("when an operator deletes it", () => {
      it("reports no delete without claiming a lease refusal", async () => {
        const result = await ops.deleteBlob({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
          requestedBy: "operator",
        });

        expect(result).toEqual({ deleted: false });
      });
    });
  });

  describe("given a described blob", () => {
    describe("when it is fetched by id", () => {
      it("carries the sweep verdict the runner would reach for it", async () => {
        // Unreferenced with a long backstop: the sweep would shorten it.
        await redis.set(blobKey, "body", "EX", 4 * 24 * 3600);

        const summary = await ops.tryGetBlob({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(summary?.sweepOutcome).toBe("repaired");
        expect(summary?.liveLeases).toBe(0);
      });
    });
  });
});
