import { describe, expect, it } from "vitest";

import { BLOB_BACKSTOP_TTL_SECONDS } from "../blobConstants.ts";
import { createTenantId } from "../storage.ts";
import {
  type BlobRef,
  contentHash,
  type ObjectStore,
  TieredBlobStore,
  TransientBlobStoreError,
} from "../tieredBlobStore.ts";
import { InMemoryJobBlobStore, InMemoryObjectStore, mintTestUri } from "./blob-test-doubles.ts";

const PROJECT = createTenantId("project-abc");

function makeStore(s3ThresholdBytes = 256 * 1024) {
  const redisBlobs = new InMemoryJobBlobStore();
  const objectStore = new InMemoryObjectStore();
  const store = new TieredBlobStore({
    redisBlobs,
    objectStoreFor: () => objectStore,
    mintUri: mintTestUri,
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
        expect([...redisBlobs.store.keys()]).toEqual([`${PROJECT}/${contentHash(data)}`]);
      });

      it("round-trips the bytes back through get", async () => {
        const { store } = makeStore();
        const data = Buffer.from("round trip me");

        const ref = await store.put({ projectId: PROJECT, data });

        expect(await store.get(ref)).toEqual(data);
      });

      /**
       * Regression: TieredBlobStore wrote through RedisJobBlobStore's
       * default (GQ1's 7-day backstop) instead of GQ2's leased 4-day
       * backstop, so a leaked blob lived days longer (2026-07-09 investigation).
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

        const expectedUri = `s3://test-bucket/group-queue/${PROJECT}/${contentHash(data)}`;
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

  describe("given a payload over the S3 threshold and an azure destination", () => {
    /**
     * Covers the groupQueue-blob-store HALF of this scenario; the
     * defaultMintStorageUri half lives in stored-objects.service.unit.test.ts.
     */
    /** @scenario "defaultMintStorageUri and the groupQueue blob store mint azure-blob URIs for an azure destination" */
    it("mints an azure-blob uri under the durable tier and round-trips the bytes", async () => {
      const redisBlobs = new InMemoryJobBlobStore();
      const objectStore = new InMemoryObjectStore();
      const store = new TieredBlobStore({
        redisBlobs,
        objectStoreFor: () => objectStore,
        mintUri: mintTestUri,
        resolveDestination: async () => ({
          kind: "azure",
          accountName: "lwacct",
          container: "lw-container",
        }),
        s3ThresholdBytes: 8,
      });
      const data = Buffer.from("this comfortably exceeds the threshold");

      const ref = await store.put({ projectId: PROJECT, data });

      // The "s3" tier label means "durable object store, any scheme" —
      // azure-blob rides under it unchanged (BlobRef has no separate
      // "azure" tier).
      expect(ref.tier).toBe("s3");
      const expectedUri = `azure-blob://lwacct/lw-container/group-queue/${PROJECT}/${contentHash(data)}`;
      expect([...objectStore.store.keys()]).toEqual([expectedUri]);
      expect(await store.get(ref)).toEqual(data);
    });
  });

  describe("given a payload above the S3 threshold for a project", () => {
    describe("when it is offloaded", () => {
      /** @scenario "The S3-tier key carries the lifecycle prefix first" */
      it("writes only under group-queue/<projectId>/<hash>", async () => {
        const { store, objectStore } = makeStore(8);
        const data = Buffer.from("a payload well above the tiny threshold");

        await store.put({ projectId: PROJECT, data });

        const [key, ...rest] = [...objectStore.store.keys()];
        expect(rest).toEqual([]);
        const segments = new URL(key!).pathname.split("/").filter(Boolean);
        expect(segments).toEqual(["group-queue", PROJECT, contentHash(data)]);
      });
    });
  });

  describe("given two payloads with byte-identical canonical serializations", () => {
    describe("when each is offloaded to the S3 tier", () => {
      /** @scenario "The same bytes always produce the same blob key" */
      it("resolves both to one key and issues a PUT for each", async () => {
        const { store, objectStore } = makeStore(8);
        const puts: string[] = [];
        const put = objectStore.put.bind(objectStore);
        objectStore.put = async (uri, bytes, mediaType) => {
          puts.push(uri);
          return put(uri, bytes, mediaType);
        };
        const data = Buffer.from("identical bytes over the threshold");

        const first = await store.put({ projectId: PROJECT, data });
        const second = await store.put({ projectId: PROJECT, data: Buffer.from(data) });

        expect(second).toEqual(first);
        expect(objectStore.store.size).toBe(1);
        expect(puts).toHaveLength(2);
        expect(puts[1]).toBe(puts[0]);
      });
    });
  });

  describe("given an S3-tier envelope staged under the old <projectId>/<hash> key", () => {
    describe("when the new key is missing and the blob is read", () => {
      /** @scenario "A blob staged before the move is read from its old key" */
      it("reads the old key and returns the payload intact", async () => {
        const { store, objectStore } = makeStore(8);
        const data = Buffer.from("staged before the prefix move");
        const hash = contentHash(data);
        objectStore.store.set(`s3://test-bucket/${PROJECT}/${hash}`, data);

        const ref: BlobRef = { tier: "s3", projectId: PROJECT, hash };

        expect(await store.get(ref)).toEqual(data);
        expect(await store.peek(ref)).toEqual(data);
      });

      /** @scenario "A blob staged before the move is read from its old key" */
      it("returns null when the key is missing at both addresses", async () => {
        const { store } = makeStore(8);
        const ref: BlobRef = { tier: "s3", projectId: PROJECT, hash: "neverstaged" };

        expect(await store.get(ref)).toBeNull();
      });

      it("prefers the new key when both addresses hold a blob", async () => {
        const { store, objectStore } = makeStore(8);
        const hash = "samehash";
        objectStore.store.set(`s3://test-bucket/${PROJECT}/${hash}`, Buffer.from("old"));
        objectStore.store.set(
          `s3://test-bucket/group-queue/${PROJECT}/${hash}`,
          Buffer.from("new"),
        );

        const ref: BlobRef = { tier: "s3", projectId: PROJECT, hash };

        expect((await store.get(ref))?.toString()).toBe("new");
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
        expect([...redisBlobs.store.keys()].toSorted()).toEqual(
          [`tenant-a/${contentHash(data)}`, `tenant-b/${contentHash(data)}`].toSorted(),
        );
      });
    });
  });

  describe("given byte-identical S3-tier payloads under different tenants", () => {
    describe("when each is offloaded", () => {
      /** @scenario "Blob keys are namespaced by tenant so tenants never share a blob" */
      it("keys each under group-queue/<its own projectId> and never resolves across tenants", async () => {
        const { store, objectStore } = makeStore(8);
        const data = Buffer.from("identical user content above the threshold");
        const tenantA = createTenantId("tenant-a");
        const tenantB = createTenantId("tenant-b");

        const refA = await store.put({ projectId: tenantA, data });
        const refB = await store.put({ projectId: tenantB, data });

        expect([...objectStore.store.keys()].toSorted()).toEqual([
          `s3://test-bucket/group-queue/tenant-a/${contentHash(data)}`,
          `s3://test-bucket/group-queue/tenant-b/${contentHash(data)}`,
        ]);
        expect(refA).not.toEqual(refB);
        objectStore.store.delete(`s3://test-bucket/group-queue/tenant-b/${contentHash(data)}`);
        expect(await store.get(refB)).toBeNull();
        expect(await store.get(refA)).toEqual(data);
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
        const data = Buffer.from("over the threshold so it lands in the s3 tier");
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
        };
        const store = new TieredBlobStore({
          redisBlobs: new InMemoryJobBlobStore(),
          objectStoreFor: () => flaky,
          mintUri: mintTestUri,
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

        await expect(store.get(ref)).rejects.toBeInstanceOf(TransientBlobStoreError);
      });
    });
  });

  describe("given the destination resolver fails", () => {
    describe("when a blob is fetched", () => {
      it("throws TransientBlobStoreError (a resolve failure is never a missing blob)", async () => {
        const store = new TieredBlobStore({
          redisBlobs: new InMemoryJobBlobStore(),
          objectStoreFor: () => new InMemoryObjectStore(),
          mintUri: mintTestUri,
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

        await expect(store.get(ref)).rejects.toBeInstanceOf(TransientBlobStoreError);
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
