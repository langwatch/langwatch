import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  blobHolderSetKey,
  blobLeaseSetKey,
  LEGACY_HOLDER_LEASE_GUARD,
  redisBlobKey,
} from "@langwatch/group-queue/operational";
import type { ProjectApi } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import type { UserApi } from "@langwatch/user-contract";
import Redis, { type Redis as RedisClient } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OpsOperations } from "../app/ops-operations.ts";
import type { QueuePayloadDecoder, QueuePayloadDecoding } from "../app/ops.app.ts";
import type { SchedulerOpsRepository } from "../repositories/scheduler-ops.repository.ts";
import type { OpsService } from "../services/ops.service.ts";
import { NoopSchedulerWakeService } from "../services/scheduler-wake.service.ts";

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
  findForOps: async () => [],
  listPausedForOps: async () => ({ rows: [], total: 0 }),
};

const projects = createApiFixture<ProjectApi>({ listNamesByIds: async () => [] });

class NoopQueuePayloadDecoder implements QueuePayloadDecoder {
  async decode(): Promise<QueuePayloadDecoding> {
    return { kind: "undecodable" };
  }
}

/**
 * The operator delete path against a live Redis.
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
    ops = OpsOperations.create({
      database: prismaDouble({
        user: { findUnique: async () => null },
        session: { update: async () => ({}) },
      }),
      adminEmails: [],
      audit: { record: async () => undefined },
      auditLog: createApiFixture<AuditLogApi>(),
      users: {} as UserApi,
      auth: createApiFixture<AuthApi>(),
      redis,
      queuePayloads: new NoopQueuePayloadDecoder(),
      scheduler: {
        repository: schedulerRepository,
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
      /** @scenario "Blob deletion refuses a live lease atomically" */
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

        const summary = await ops.findBlob({
          queueName: QUEUE,
          projectId: PROJECT,
          hash: HASH,
        });

        expect(summary?.sweepOutcome).toBe("repaired");
        expect(summary?.liveLeases).toBe(0);
      });
    });
  });

  describe("given several blobs an operator wants ranked", () => {
    describe("when the listing reads a bounded sample", () => {
      /** @scenario "Blob listing reports sampled ordering honestly" */
      it("reports how many it looked at and whether the ranking is only of that sample", async () => {
        for (const [hash, body] of [
          ["blobrepolist01", "x".repeat(10)],
          ["blobrepolist02", "x".repeat(100)],
          ["blobrepolist03", "x".repeat(1000)],
        ] as const) {
          await redis.set(
            redisBlobKey({ queueName: QUEUE, projectId: tenant, hash }),
            body,
            "EX",
            3600,
          );
        }

        const page = await ops.listBlobs({
          queueName: QUEUE,
          projectId: tenant,
          limit: 10,
          sort: "largest",
        });

        expect(page.blobs.map((blob) => blob.hash)).toEqual([
          "blobrepolist03",
          "blobrepolist02",
          "blobrepolist01",
        ]);
        expect(page.sampled).toBe(3);
        expect(page.rankedFromSample).toBe(false);
        expect(page.nextCursor).toBeNull();
      });
    });
  });
});
