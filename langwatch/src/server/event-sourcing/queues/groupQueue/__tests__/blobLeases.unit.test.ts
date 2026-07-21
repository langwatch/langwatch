import { describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { BlobLeases } from "../blobLeases";
import { CachedLuaScript } from "../cachedLuaScript";

const PROJECT = createTenantId("project-1");

describe("BlobLeases", () => {
  describe("given a queue-scoped lease primitive", () => {
    describe("when a lease is taken", () => {
      it("uses tenant-namespaced lease and rolling-deploy guard keys", async () => {
        const run = vi
          .spyOn(CachedLuaScript.prototype, "run")
          .mockResolvedValue(1);
        const redis = {} as ConstructorParameters<
          typeof BlobLeases
        >[0]["redis"];
        const leases = new BlobLeases({
          redis,
          queueName: "{queue}",
          leaseTtlSeconds: 30,
        });

        await leases.take({
          projectId: PROJECT,
          hash: "hash-1",
          holderId: "holder-1",
          tier: "redis",
        });

        expect(run).toHaveBeenCalledWith(
          redis,
          3,
          "{queue}:gq:blobleases:project-1/hash-1",
          "{queue}:gq:blobholders:project-1/hash-1",
          "{queue}:gq:blob:project-1/hash-1",
          "holder-1",
          "30",
        );
      });
    });

    describe("when an S3-tier lease is released", () => {
      it("does not pass a blob key to the release script", async () => {
        const run = vi
          .spyOn(CachedLuaScript.prototype, "run")
          .mockResolvedValue(0);
        const redis = {} as ConstructorParameters<
          typeof BlobLeases
        >[0]["redis"];
        const leases = new BlobLeases({ redis, queueName: "{queue}" });

        await leases.release({
          projectId: PROJECT,
          hash: "hash-1",
          holderId: "holder-1",
          tier: "s3",
        });

        expect(run).toHaveBeenCalledWith(
          redis,
          2,
          "{queue}:gq:blobleases:project-1/hash-1",
          "{queue}:gq:blobholders:project-1/hash-1",
          "holder-1",
        );
        // lastCall, not calls[0]: the spy is on the shared prototype and is not
        // reset between tests in this file.
        expect(run.mock.lastCall).not.toContain(
          "{queue}:gq:blob:project-1/hash-1",
        );
      });
    });

    describe("when a Redis-tier lease is released", () => {
      it("passes the blob key so the grace window can reach it", async () => {
        const run = vi
          .spyOn(CachedLuaScript.prototype, "run")
          .mockResolvedValue(1);
        const redis = {} as ConstructorParameters<
          typeof BlobLeases
        >[0]["redis"];
        const leases = new BlobLeases({ redis, queueName: "{queue}" });

        const graced = await leases.release({
          projectId: PROJECT,
          hash: "hash-1",
          holderId: "holder-1",
          tier: "redis",
        });

        expect(run).toHaveBeenCalledWith(
          redis,
          3,
          "{queue}:gq:blobleases:project-1/hash-1",
          "{queue}:gq:blobholders:project-1/hash-1",
          "{queue}:gq:blob:project-1/hash-1",
          "holder-1",
        );
        expect(graced).toBe(true);
      });
    });

    describe("when a release leaves other holders behind", () => {
      it("reports that no grace window was applied", async () => {
        vi.spyOn(CachedLuaScript.prototype, "run").mockResolvedValue(0);
        const redis = {} as ConstructorParameters<
          typeof BlobLeases
        >[0]["redis"];
        const leases = new BlobLeases({ redis, queueName: "{queue}" });

        const graced = await leases.release({
          projectId: PROJECT,
          hash: "hash-1",
          holderId: "holder-1",
          tier: "redis",
        });

        expect(graced).toBe(false);
      });
    });

    describe("when a Redis-tier lease is renewed", () => {
      it("refreshes the lease and blob in one script", async () => {
        const run = vi
          .spyOn(CachedLuaScript.prototype, "run")
          .mockResolvedValue(1);
        const redis = {} as ConstructorParameters<
          typeof BlobLeases
        >[0]["redis"];
        const leases = new BlobLeases({ redis, queueName: "{queue}" });

        await leases.renew({
          projectId: PROJECT,
          hash: "hash-1",
          holderId: "holder-1",
          tier: "redis",
        });

        expect(run).toHaveBeenCalledWith(
          redis,
          3,
          "{queue}:gq:blobleases:project-1/hash-1",
          "{queue}:gq:blobholders:project-1/hash-1",
          "{queue}:gq:blob:project-1/hash-1",
          "holder-1",
          expect.any(String),
        );
      });
    });
  });
});
