/**
 * Unit tests for BlobStore spool operations (ADR-022 write/read path).
 *
 * Covers: putSpool, getSpool, deleteSpool across every storage destination, the
 * v1 reference format retained for the rollout, and the property that a
 * reference cannot steer a read (langwatch/langwatch-saas#800).
 * getFromEventLog is covered by blob-store.event-log.unit.test.ts.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import type { ProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { StreamTooLargeError } from "~/utils/streamToBuffer";
import {
  BlobStore,
  MAX_SPOOL_BYTES,
  type S3ClientResolver,
  SPOOL_REF_V2,
  type SpoolStorage,
} from "./blob-store.service";

/**
 * In-memory stand-in for the stored-objects StorageRegistry, keyed by URI.
 * Records every URI it is asked for so the tests can assert on the location
 * the spool derived, not just on the bytes coming back.
 */
function fakeObjectStore() {
  const objects = new Map<string, Buffer>();
  const putUris: string[] = [];
  const getUris: string[] = [];
  const deleteUris: string[] = [];
  return {
    objects,
    putUris,
    getUris,
    deleteUris,
    put: vi.fn(async (uri: string, bytes: Buffer) => {
      putUris.push(uri);
      objects.set(uri, bytes);
    }),
    get: vi.fn(async (uri: string) => {
      getUris.push(uri);
      const stored = objects.get(uri);
      if (!stored) {
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return Readable.from([stored]);
    }),
    delete: vi.fn(async (uri: string) => {
      deleteUris.push(uri);
      objects.delete(uri);
    }),
  };
}

function spoolStorageFor(
  store: ReturnType<typeof fakeObjectStore>,
  destination: ProjectStorageDestination,
): SpoolStorage {
  return {
    objectStoreFor: () => store,
    resolveDestination: async () => destination,
  };
}

/** In-memory fake S3 keyed by `${bucket}/${key}` — the v1 read path only. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const { Bucket, Key, Body } = command.input;
      objects.set(`${Bucket}/${Key}`, Body as Buffer);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const { Bucket, Key } = command.input;
      const stored = objects.get(`${Bucket}/${Key}`);
      if (!stored) {
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return {
        Body: { transformToByteArray: async () => new Uint8Array(stored) },
      };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(`${command.input.Bucket}/${command.input.Key}`);
      return {};
    }
    throw new Error("unexpected command");
  });
  return { objects, s3Client: { send } as never };
}

function resolverFor(fake: ReturnType<typeof fakeS3>): S3ClientResolver {
  return async () => ({ s3Client: fake.s3Client, s3Bucket: "test-bucket" });
}

/** An S3 resolver that fails the test if anything reaches it. */
const forbiddenS3Resolver: S3ClientResolver = async () => {
  throw new Error("the S3 client must not be reached on the v2 spool path");
};

const spoolCoords = {
  projectId: "orgA",
  traceId: "trace-1",
  spanId: "span-1",
};

const S3_DESTINATION: ProjectStorageDestination = {
  kind: "s3",
  bucket: "test-bucket",
};
const AZURE_DESTINATION: ProjectStorageDestination = {
  kind: "azure",
  accountName: "acct",
  container: "cont",
};
const FILE_DESTINATION: ProjectStorageDestination = {
  kind: "file",
  root: "/var/lib/langwatch/objects",
};

describe("putSpool — given each supported storage destination", () => {
  describe("when putSpool is called", () => {
    it.each([
      {
        name: "s3",
        destination: S3_DESTINATION,
        expectedUri: "s3://test-bucket/trace-blobs/spool/orgA/trace-1/span-1",
      },
      {
        name: "azure",
        destination: AZURE_DESTINATION,
        expectedUri:
          "azure-blob://acct/cont/trace-blobs/spool/orgA/trace-1/span-1",
      },
      {
        name: "local filesystem",
        destination: FILE_DESTINATION,
        expectedUri:
          "file:///var/lib/langwatch/objects/trace-blobs/spool/orgA/trace-1/span-1",
      },
    ])("writes to the $name destination the deployment resolved", async ({
      destination,
      expectedUri,
    }) => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, destination),
      });

      await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("span payload data", "utf-8"),
      });

      expect(objectStore.putUris).toEqual([expectedUri]);
    });
  });
});

describe("putSpool — given a span payload body", () => {
  describe("when putSpool is called", () => {
    it("returns a reference carrying no storage location", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, AZURE_DESTINATION),
      });

      const spoolRef = await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("payload", "utf-8"),
      });

      expect(spoolRef).toBe(SPOOL_REF_V2);
      expect(spoolRef).not.toContain(spoolCoords.projectId);
      expect(spoolRef).not.toContain("test-bucket");
    });

    it("issues exactly ONE write", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, S3_DESTINATION),
      });

      await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("payload", "utf-8"),
      });

      expect(objectStore.put).toHaveBeenCalledTimes(1);
    });
  });
});

describe("putSpool — given an OTLP id containing a path separator", () => {
  describe("when putSpool is called", () => {
    it("keeps the object under the spool prefix", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, S3_DESTINATION),
      });

      // Base64-encoded OTLP ids can contain "/", which unescaped would
      // inject extra path segments — or, leading, escape the prefix that
      // the lifecycle rule matches on.
      await store.putSpool({
        projectId: "orgA",
        traceId: "../../etc",
        spanId: "a/b",
        body: Buffer.from("payload", "utf-8"),
      });

      expect(objectStore.putUris[0]).toBe(
        "s3://test-bucket/trace-blobs/spool/orgA/..%2F..%2Fetc/a%2Fb",
      );
    });
  });
});

describe("putSpool — given no spool storage is configured", () => {
  describe("when putSpool is called", () => {
    it("throws rather than falling back to a hardcoded backend", async () => {
      const store = new BlobStore({ resolveS3Client: forbiddenS3Resolver });

      await expect(
        store.putSpool({
          ...spoolCoords,
          body: Buffer.from("payload", "utf-8"),
        }),
      ).rejects.toThrow(/no spool storage configured/i);
    });
  });
});

describe("getSpool — given a spool object written by putSpool", () => {
  describe("when getSpool is called with the command's own coordinates", () => {
    it("returns the exact bytes that were put", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, AZURE_DESTINATION),
      });
      const originalBody = Buffer.from("exact span body bytes", "utf-8");

      const spoolRef = await store.putSpool({
        ...spoolCoords,
        body: originalBody,
      });
      const retrieved = await store.getSpool({ spoolRef, ...spoolCoords });

      expect(retrieved).toEqual(originalBody);
    });
  });
});

describe("getSpool — given a reference naming another tenant's object", () => {
  describe("when getSpool is called", () => {
    it("reads the location derived from the command, ignoring the reference", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, S3_DESTINATION),
      });
      const victimBytes = Buffer.from("another tenant's payload", "utf-8");
      await store.putSpool({
        projectId: "victim-org",
        traceId: "trace-1",
        spanId: "span-1",
        body: victimBytes,
      });
      const ownBytes = Buffer.from("my own payload", "utf-8");
      await store.putSpool({ ...spoolCoords, body: ownBytes });

      // A reference that names the victim's object, on a command
      // authenticated as orgA. The reference must not be honoured.
      const retrieved = await store.getSpool({
        spoolRef:
          "s3://test-bucket/trace-blobs/spool/victim-org/trace-1/span-1",
        ...spoolCoords,
      });

      expect(retrieved).toEqual(ownBytes);
      expect(objectStore.getUris).toEqual([
        "s3://test-bucket/trace-blobs/spool/orgA/trace-1/span-1",
      ]);
    });
  });
});

describe("getSpool — given a v1-shaped reference naming another tenant", () => {
  describe("when getSpool is called", () => {
    it("refuses rather than reading across the tenant boundary", async () => {
      const fake = fakeS3();
      const victimKey = "trace-blobs/spool/victim-org/trace-1/span-1";
      fake.objects.set(
        `test-bucket/${victimKey}`,
        Buffer.from("another tenant's payload", "utf-8"),
      );
      const store = new BlobStore({
        resolveS3Client: resolverFor(fake),
        spoolStorage: spoolStorageFor(fakeObjectStore(), S3_DESTINATION),
      });

      await expect(
        store.getSpool({ spoolRef: victimKey, ...spoolCoords }),
      ).rejects.toThrow(/authenticated as "orgA"/);
    });
  });
});

describe("getSpool — given a v1 reference written before this deployment", () => {
  describe("when getSpool is called", () => {
    it("still resolves it through the legacy S3 path", async () => {
      const fake = fakeS3();
      const legacyKey = "trace-blobs/spool/orgA/trace-1/span-1";
      const legacyBytes = Buffer.from("queued before the deploy", "utf-8");
      fake.objects.set(`test-bucket/${legacyKey}`, legacyBytes);

      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: resolverFor(fake),
        spoolStorage: spoolStorageFor(objectStore, AZURE_DESTINATION),
      });

      const retrieved = await store.getSpool({
        spoolRef: legacyKey,
        ...spoolCoords,
      });

      expect(retrieved).toEqual(legacyBytes);
      expect(objectStore.get).not.toHaveBeenCalled();
    });
  });
});

describe("getSpool — given an object larger than the read cap", () => {
  describe("when getSpool is called", () => {
    it("rejects instead of buffering it whole", async () => {
      const objectStore = fakeObjectStore();
      // Emitted lazily in 1 MB chunks — the cap should trip long before
      // anything close to MAX_SPOOL_BYTES is actually resident.
      objectStore.get.mockImplementationOnce(async () =>
        Readable.from(
          (function* () {
            for (let sent = 0; sent <= MAX_SPOOL_BYTES; sent += 1024 * 1024) {
              yield Buffer.alloc(1024 * 1024);
            }
          })(),
        ),
      );
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, S3_DESTINATION),
      });

      await expect(
        store.getSpool({ spoolRef: SPOOL_REF_V2, ...spoolCoords }),
      ).rejects.toThrow(StreamTooLargeError);
    });
  });
});

describe("getSpool — given the object is missing", () => {
  describe("when getSpool is called", () => {
    it("throws rather than returning an empty span", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, S3_DESTINATION),
      });

      await expect(
        store.getSpool({ spoolRef: SPOOL_REF_V2, ...spoolCoords }),
      ).rejects.toThrow();
    });
  });
});

describe("deleteSpool — given an existing spool object", () => {
  describe("when deleteSpool is called", () => {
    it("deletes the object it wrote", async () => {
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, AZURE_DESTINATION),
      });
      const spoolRef = await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("to be deleted", "utf-8"),
      });

      await store.deleteSpool({ spoolRef, ...spoolCoords });

      expect(objectStore.deleteUris).toEqual([
        "azure-blob://acct/cont/trace-blobs/spool/orgA/trace-1/span-1",
      ]);
      expect(objectStore.objects.size).toBe(0);
    });
  });
});

describe("deleteSpool — given a v1 reference", () => {
  describe("when deleteSpool is called", () => {
    it("deletes through the legacy S3 path", async () => {
      const fake = fakeS3();
      const legacyKey = "trace-blobs/spool/orgA/trace-1/span-1";
      fake.objects.set(`test-bucket/${legacyKey}`, Buffer.from("old"));
      const objectStore = fakeObjectStore();
      const store = new BlobStore({
        resolveS3Client: resolverFor(fake),
        spoolStorage: spoolStorageFor(objectStore, AZURE_DESTINATION),
      });

      await store.deleteSpool({ spoolRef: legacyKey, ...spoolCoords });

      expect(fake.objects.size).toBe(0);
      expect(objectStore.delete).not.toHaveBeenCalled();
    });
  });
});

describe("deleteSpool — given the storage backend rejects the delete", () => {
  describe("when deleteSpool is called", () => {
    it("does not throw (best-effort — the lifecycle rule is the safety net)", async () => {
      const objectStore = fakeObjectStore();
      objectStore.delete.mockRejectedValueOnce(new Error("AccessDenied"));
      const store = new BlobStore({
        resolveS3Client: forbiddenS3Resolver,
        spoolStorage: spoolStorageFor(objectStore, S3_DESTINATION),
      });

      await expect(
        store.deleteSpool({ spoolRef: SPOOL_REF_V2, ...spoolCoords }),
      ).resolves.toBeUndefined();
    });
  });
});
