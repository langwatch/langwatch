import { describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { BLOB_BACKSTOP_TTL_SECONDS } from "../blobConstants";
import {
  type BlobRef,
  contentHash,
  type ObjectStore,
  TieredBlobStore,
  TransientBlobStoreError,
} from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

const PROJECT = createTenantId("project-abc");

function makeStore(s3ThresholdBytes = 256 * 1024) {
  const redisBlobs = new InMemoryJobBlobStore();
  const objectStore = new InMemoryObjectStore();
  const store = new TieredBlobStore({
    redisBlobs,
    objectStoreFor: () => objectStore,
    resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
    s3ThresholdBytes,
  });
  return { store, redisBlobs, objectStore };
}

describe("TieredBlobStore", () => {
  describe("given a payload under the S3 threshold", () => {
    describe("when it is put", () => {
      it("stores it in the Redis tier under a projectId-namespaced key", async () => {
        const { store, redisBlobs } = makeStore();
        const data = Buffer.from("a small payload");

        const ref = await store.put({ projectId: PROJECT, data });

        expect(ref.tier).toBe("redis");
        expect([...redisBlobs.store.keys()]).toEqual([
          `${PROJECT}/${contentHash(data)}`,
        ]);
      });

      it("round-trips the bytes back through get", async () => {
        const { store } = makeStore();
        const data = Buffer.from("round trip me");

        const ref = await store.put({ projectId: PROJECT, data });

        expect(await store.get(ref)).toEqual(data);
      });

      /**
       * Regression: TieredBlobStore wrote through RedisJobBlobStore's default
       * (GQ1's 7-day staged-residence backstop) instead of the refcounted GQ2
       * GQ2 orphan backstop the spec configures ("the blob TTL backstop is
       * configured at 4 days"), so every leaked blob lived days longer than
       * designed (2026-07-09 Redis memory investigation).
       */
      it("writes and refreshes with the 4-day GQ2 backstop, not GQ1's 7-day default", async () => {
        const { store, redisBlobs } = makeStore();
        const data = Buffer.from("ttl pinning payload");

        const ref = await store.put({ projectId: PROJECT, data });
        await store.get(ref);

        expect(redisBlobs.putTtls).toEqual([BLOB_BACKSTOP_TTL_SECONDS]);
        expect(redisBlobs.getTtls).toEqual([BLOB_BACKSTOP_TTL_SECONDS]);
      });

      it("peeks without refreshing any TTL", async () => {
        const { store, redisBlobs } = makeStore();
        const data = Buffer.from("peek me");

        const ref = await store.put({ projectId: PROJECT, data });
        await store.peek(ref);

        expect(redisBlobs.getTtls).toEqual([]);
      });
    });
  });

  describe("given a payload over the S3 threshold", () => {
    describe("when it is put", () => {
      it("stores it in the S3 tier under a projectId-namespaced s3 uri", async () => {
        const { store, objectStore } = makeStore(8);
        const data = Buffer.from("this comfortably exceeds the threshold");

        const ref = await store.put({ projectId: PROJECT, data });

        const expectedUri = `s3://test-bucket/${PROJECT}/${contentHash(data)}`;
        expect(ref.tier).toBe("s3");
        expect(ref).toMatchObject({
          projectId: PROJECT,
          hash: contentHash(data),
        });
        expect([...objectStore.store.keys()]).toEqual([expectedUri]);
      });

      it("round-trips the bytes back through get", async () => {
        const { store } = makeStore(8);
        const data = Buffer.from("durable tier round trip");

        const ref = await store.put({ projectId: PROJECT, data });

        expect(await store.get(ref)).toEqual(data);
      });
    });
  });

  describe("given two byte-identical payloads in the same project", () => {
    describe("when both are put", () => {
      it("collapses them to one content-addressed key", async () => {
        const { store, redisBlobs } = makeStore();
        const data = Buffer.from("the very same bytes");

        const first = await store.put({ projectId: PROJECT, data });
        const second = await store.put({
          projectId: PROJECT,
          data: Buffer.from(data),
        });

        expect(second).toEqual(first);
        expect(redisBlobs.store.size).toBe(1);
      });
    });
  });

  describe("given byte-identical payloads under different tenants", () => {
    describe("when each is put", () => {
      it("namespaces them to different keys so tenants never share a blob", async () => {
        const { store, redisBlobs } = makeStore();
        const data = Buffer.from("identical user content");

        const a = await store.put({
          projectId: createTenantId("tenant-a"),
          data,
        });
        const b = await store.put({
          projectId: createTenantId("tenant-b"),
          data,
        });

        expect(a).not.toEqual(b);
        expect([...redisBlobs.store.keys()].sort()).toEqual(
          [
            `tenant-a/${contentHash(data)}`,
            `tenant-b/${contentHash(data)}`,
          ].sort(),
        );
      });
    });
  });

  describe("given a stored blob", () => {
    describe("when it is deleted", () => {
      it("removes it from its tier", async () => {
        const { store, redisBlobs } = makeStore();
        const ref = await store.put({
          projectId: PROJECT,
          data: Buffer.from("delete me"),
        });

        await store.delete(ref);

        expect(redisBlobs.store.size).toBe(0);
      });
    });
  });

  describe("given an s3-tier blob that is genuinely gone", () => {
    describe("when it is fetched", () => {
      it("returns null so decode reaches the missing-blob fail-safe", async () => {
        const { store, objectStore } = makeStore(8);
        const data = Buffer.from(
          "over the threshold so it lands in the s3 tier",
        );
        const ref = await store.put({ projectId: PROJECT, data });
        objectStore.store.clear(); // the object vanished (NoSuchKey)

        expect(await store.get(ref)).toBeNull();
      });
    });
  });

  describe("given the s3 store is failing transiently", () => {
    describe("when a blob is fetched", () => {
      it("throws TransientBlobStoreError so the job retries instead of dropping", async () => {
        const flaky: ObjectStore = {
          put: async () => {},
          get: async () => {
            throw new Error("ECONNRESET");
          },
          delete: async () => {},
        };
        const store = new TieredBlobStore({
          redisBlobs: new InMemoryJobBlobStore(),
          objectStoreFor: () => flaky,
          resolveDestination: async () => ({
            kind: "s3",
            bucket: "test-bucket",
          }),
          s3ThresholdBytes: 8,
        });
        const ref: BlobRef = {
          tier: "s3",
          projectId: PROJECT,
          hash: "deadbeefdeadbeef",
        };

        await expect(store.get(ref)).rejects.toBeInstanceOf(
          TransientBlobStoreError,
        );
      });
    });
  });

  describe("given the destination resolver fails", () => {
    describe("when a blob is fetched", () => {
      it("throws TransientBlobStoreError (a resolve failure is never a missing blob)", async () => {
        const store = new TieredBlobStore({
          redisBlobs: new InMemoryJobBlobStore(),
          objectStoreFor: () => new InMemoryObjectStore(),
          resolveDestination: async () => {
            // Even a NotFound-shaped resolve error must be transient, not missing.
            const err = new Error("resolve not-found");
            err.name = "NotFound";
            throw err;
          },
          s3ThresholdBytes: 8,
        });
        const ref: BlobRef = {
          tier: "s3",
          projectId: PROJECT,
          hash: "deadbeefdeadbeef",
        };

        await expect(store.get(ref)).rejects.toBeInstanceOf(
          TransientBlobStoreError,
        );
      });
    });
  });

  describe("given a hash source distinct from the stored bytes", () => {
    describe("when put", () => {
      it("keys by the hash source, not the stored bytes (gzip-determinism independence)", async () => {
        const { store, redisBlobs } = makeStore();
        const raw = Buffer.from("the raw json source");
        const stored = Buffer.from("DIFFERENT bytes that actually get stored");

        const ref = await store.put({
          projectId: PROJECT,
          data: stored,
          hashSource: raw,
        });

        expect(ref.hash).toBe(contentHash(raw));
        expect([...redisBlobs.store.values()]).toEqual([stored]);
      });
    });
  });
});
