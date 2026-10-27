/**
 * @see ADR-022
 * Tests TraceBlobStoreService spool operations: put/get/delete across storage
 * destinations, v1 reference format rollout, and read safety (issue #800).
 */
import { Readable } from "node:stream";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import {
  type S3ClientResolver,
  S3TraceLegacySpoolChannel,
} from "../../../../channels/s3/s3.trace-legacy-spool.channel.ts";
import type {
  TraceSpoolDestinationKind,
  TraceSpoolObjectAddress,
  TraceSpoolObjectsRepository,
} from "../../../../repositories/trace-spool-objects.repository.ts";
import { StreamTooLargeError } from "../../../../services/trace-stream-buffer.service.ts";
import { SPOOL_REF_V2 } from "../../../ingestion/rules/trace-spool-location.rules.ts";
import {
  TraceBlobStoreService,
  MAX_SPOOL_BYTES,
  SpoolDestinationUnsupportedError,
  type SpoolStorage,
} from "../trace-blob-store.service.ts";

/**
 * In-memory stand-in for the spool's object repository, keyed by project and key.
 * Records every address it is asked for so the tests can assert on the location
 * the spool derived, not just on the bytes coming back.
 */
function fakeObjectStore(destination: TraceSpoolDestinationKind = "s3") {
  const objects = new Map<string, Buffer>();
  const putKeys: string[] = [];
  const getKeys: string[] = [];
  const deleteKeys: string[] = [];
  const slot = (at: TraceSpoolObjectAddress) => `${at.projectId}:${at.key}`;
  const store = {
    objects,
    putKeys,
    getKeys,
    deleteKeys,
    destinationKind: vi.fn(async () => destination),
    write: vi.fn(async (at: TraceSpoolObjectAddress, bytes: Buffer) => {
      putKeys.push(slot(at));
      objects.set(slot(at), bytes);
    }),
    read: vi.fn(async (at: TraceSpoolObjectAddress) => {
      getKeys.push(slot(at));
      const stored = objects.get(slot(at));
      if (!stored) {
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return Readable.from([stored]);
    }),
    remove: vi.fn(async (at: TraceSpoolObjectAddress) => {
      deleteKeys.push(slot(at));
      objects.delete(slot(at));
    }),
  };
  return store satisfies TraceSpoolObjectsRepository;
}

function spoolStorageFor(store: ReturnType<typeof fakeObjectStore>): SpoolStorage {
  return {
    objects: store,
    // Existing suites assert the write path, so they run as a deployment that
    // has provisioned retention. The refusal is covered on its own below.
    azureRetentionConfirmed: true,
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
      // A stream, as the real SDK returns — the legacy read now consumes it
      // through the same bounded helper as the v2 path.
      return { Body: Readable.from([stored]) };
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

const S3_DESTINATION: TraceSpoolDestinationKind = "s3";
const AZURE_DESTINATION: TraceSpoolDestinationKind = "azure";
const FILE_DESTINATION: TraceSpoolDestinationKind = "file";
/** Where the spool for `spoolCoords` lands: the project, then the lifecycle-prefixed key. */
const SPOOL_SLOT = "orgA:trace-blobs/spool/orgA/trace-1/span-1";

describe("putSpool — given each supported storage destination", () => {
  describe("when putSpool is called", () => {
    /** @scenario "The transient object path carries the lifecycle prefix first" */
    it.each([
      { name: "s3", destination: S3_DESTINATION },
      { name: "azure", destination: AZURE_DESTINATION },
      // The memory twin of the object-storage member, which the test tier runs on.
      { name: "memory", destination: "memory" as const },
      // No local-filesystem row on purpose: the spool refuses that
      // destination, since a filesystem cannot express the lifecycle rule the
      // orphan bound depends on. Covered by its own case below.
    ])("writes to the $name destination the deployment resolved", async ({ destination }) => {
      const objectStore = fakeObjectStore(destination);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("span payload data", "utf-8"),
      });

      expect(objectStore.putKeys).toEqual([SPOOL_SLOT]);
    });
  });
});

describe("putSpool — given a span payload body", () => {
  describe("when putSpool is called", () => {
    /** @scenario "The transient object path carries the lifecycle prefix first" */
    it("returns a reference carrying no storage location", async () => {
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
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
      const objectStore = fakeObjectStore(S3_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("payload", "utf-8"),
      });

      expect(objectStore.write).toHaveBeenCalledTimes(1);
    });
  });
});

describe("putSpool — given an OTLP id containing a path separator", () => {
  describe("when putSpool is called", () => {
    /** @scenario "An id that is not a safe path segment is hashed, not escaped" */
    it("reduces the id to one path component so nothing can escape the prefix", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await store.putSpool({
        projectId: "orgA",
        traceId: "../../etc",
        spanId: "a/b",
        body: Buffer.from("payload", "utf-8"),
      });

      // Percent-encoding alone was not enough: the local driver decodes the
      // URI before touching the filesystem, which turned `..%2F..%2F` back
      // into `../../`. Unsafe ids become a hash, which cannot carry a
      // separator no matter what decodes it downstream.
      const [slot] = objectStore.putKeys;
      const key = slot!.replace("orgA:", "");
      const segments = key.split("/");
      expect(segments.slice(0, 3)).toEqual(["trace-blobs", "spool", "orgA"]);
      expect(segments).toHaveLength(5);
      for (const segment of segments) {
        expect(segment).not.toBe("..");
        expect(segment).not.toContain("%2F");
      }
      // Decoding the whole key must not introduce separators either — this is
      // the exact step that defeated the previous encoding.
      expect(decodeURIComponent(key).split("/")).toHaveLength(5);
    });

    it("derives the same location on read and delete", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });
      const coords = { projectId: "orgA", traceId: "../../etc", spanId: "a/b" };
      const body = Buffer.from("payload", "utf-8");

      // Hashing must be deterministic, or a spooled span becomes unreadable.
      const spoolRef = await store.putSpool({ ...coords, body });
      expect(await store.getSpool({ spoolRef, ...coords })).toEqual(body);

      await store.deleteSpool({ spoolRef, ...coords });
      expect(objectStore.objects.size).toBe(0);
    });
  });
});

describe("putSpool — given Azure storage whose orphan retention is unconfirmed", () => {
  describe("when putSpool is called", () => {
    /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
    it("refuses rather than writing an object no lifecycle rule will reap", async () => {
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: {
          objects: objectStore,
          // The default for any deployment that has not said otherwise.
          azureRetentionConfirmed: false,
        },
      });

      // Azure can express the lifecycle rule, but the policy is a
      // management-plane resource and this deployment holds a data-plane key,
      // so the app cannot read it back to check. Fail closed instead: the
      // payload rides inline, which is bounded, rather than landing in a
      // container where nothing reaps it.
      await expect(
        store.putSpool({
          ...spoolCoords,
          body: Buffer.from("payload", "utf-8"),
        }),
      ).rejects.toBeInstanceOf(SpoolDestinationUnsupportedError);
      expect(objectStore.write).not.toHaveBeenCalled();
    });

    it("names the policy to create and the setting to flip", async () => {
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: {
          objects: fakeObjectStore(AZURE_DESTINATION),
          azureRetentionConfirmed: false,
        },
      });

      // An operator hitting this needs to know what to do, not just that it
      // refused.
      await expect(
        store.putSpool({
          ...spoolCoords,
          body: Buffer.from("payload", "utf-8"),
        }),
      ).rejects.toThrow(/trace-blobs\/spool\/.*3 days/s);
      await expect(
        store.putSpool({
          ...spoolCoords,
          body: Buffer.from("payload", "utf-8"),
        }),
      ).rejects.toThrow(/OBJECT_RETENTION_CONFIRMED/);
    });
  });
});

describe("given Azure retention was confirmed at write time and is unconfirmed now", () => {
  /** Assertion flip is documented remediation; must not strand objects or
   * manufacture orphans when the gate is toggled during rollback. */
  function storeAfterFlip(objectStore: ReturnType<typeof fakeObjectStore>) {
    return TraceBlobStoreService.create({
      legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
      spoolStorage: {
        objects: objectStore,
        azureRetentionConfirmed: false,
      },
    });
  }

  describe("when the worker reads a span spooled before the flip", () => {
    /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
    it("still returns the payload", async () => {
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const body = Buffer.from("the full oversized payload", "utf-8");
      const spoolRef = await TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      }).putSpool({ ...spoolCoords, body });

      expect(
        await storeAfterFlip(objectStore).getSpool({
          spoolRef,
          ...spoolCoords,
        }),
      ).toEqual(body);
    });
  });

  describe("when the worker deletes a span spooled before the flip", () => {
    /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
    it("still removes the object", async () => {
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const spoolRef = await TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      }).putSpool({
        ...spoolCoords,
        body: Buffer.from("payload", "utf-8"),
      });

      await storeAfterFlip(objectStore).deleteSpool({
        spoolRef,
        ...spoolCoords,
      });

      expect(objectStore.objects.size).toBe(0);
    });
  });
});

describe("putSpool — given S3 storage with retention unconfirmed", () => {
  describe("when putSpool is called", () => {
    it("still writes, because the flag scopes to Azure only", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: {
          objects: objectStore,
          azureRetentionConfirmed: false,
        },
      });

      // S3 deployments predate this gate and their lifecycle rule is the
      // long-standing ADR-022 requirement; widening the gate to them would be a
      // silent regression for every existing install.
      await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("payload", "utf-8"),
      });

      expect(objectStore.write).toHaveBeenCalledTimes(1);
    });
  });
});

describe("putSpool — given the project's storage is the local filesystem", () => {
  describe("when putSpool is called", () => {
    /** @scenario "A write refuses a destination that cannot reap an orphan" */
    it("refuses rather than writing an object nothing will ever reap", async () => {
      const objectStore = fakeObjectStore(FILE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      // A filesystem cannot express a lifecycle rule, so a crash between the
      // write and its delete would strand the object forever. `maybeSpool` is
      // fail-open, so ingestion continues with the payload inline.
      await expect(
        store.putSpool({
          ...spoolCoords,
          body: Buffer.from("payload", "utf-8"),
        }),
      ).rejects.toBeInstanceOf(SpoolDestinationUnsupportedError);
      expect(objectStore.write).not.toHaveBeenCalled();
    });
  });
});

describe("putSpool — given no spool storage is configured", () => {
  describe("when putSpool is called", () => {
    it("throws rather than falling back to a hardcoded backend", async () => {
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
      });

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
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
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
    /** @scenario "The spool object path is derived from the command, never read from it" */
    it("reads the location derived from the command, ignoring the reference", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
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
        spoolRef: "s3://test-bucket/trace-blobs/spool/victim-org/trace-1/span-1",
        ...spoolCoords,
      });

      expect(retrieved).toEqual(ownBytes);
      expect(objectStore.getKeys).toEqual([SPOOL_SLOT]);
    });
  });
});

describe("getSpool — given a v1-shaped reference naming another tenant", () => {
  describe("when getSpool is called", () => {
    /** @scenario "A legacy reference is pinned to the command's own tenant" */
    it("refuses rather than reading across the tenant boundary", async () => {
      const fake = fakeS3();
      const victimKey = "trace-blobs/spool/victim-org/trace-1/span-1";
      fake.objects.set(
        `test-bucket/${victimKey}`,
        Buffer.from("another tenant's payload", "utf-8"),
      );
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: resolverFor(fake) }),
        spoolStorage: spoolStorageFor(fakeObjectStore(S3_DESTINATION)),
      });

      await expect(store.getSpool({ spoolRef: victimKey, ...spoolCoords })).rejects.toThrow(
        /authenticated as "orgA"/,
      );
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

      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: resolverFor(fake) }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      const retrieved = await store.getSpool({
        spoolRef: legacyKey,
        ...spoolCoords,
      });

      expect(retrieved).toEqual(legacyBytes);
      expect(objectStore.read).not.toHaveBeenCalled();
    });
  });
});

describe("getSpool — given a v1 object larger than the read cap", () => {
  describe("when getSpool is called", () => {
    /** @scenario "A spool object larger than the cap is refused rather than buffered" */
    it("rejects instead of buffering it whole", async () => {
      const legacyKey = "trace-blobs/spool/orgA/trace-1/span-1";
      const oversizedS3 = {
        send: vi.fn(async () => ({
          // Lazy 1 MB chunks past the cap — the same shape the v2 case uses.
          Body: Readable.from(
            (function* () {
              for (let sent = 0; sent <= MAX_SPOOL_BYTES; sent += 1024 * 1024) {
                yield Buffer.alloc(1024 * 1024);
              }
            })(),
          ),
        })),
      };
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({
          resolveS3Client: async () => ({
            s3Client: oversizedS3 as never,
            s3Bucket: "test-bucket",
          }),
        }),
        spoolStorage: spoolStorageFor(fakeObjectStore(S3_DESTINATION)),
      });

      // The v1 path used to call transformToByteArray(), which buffers the
      // whole object before anything can check its size — so the cap that
      // guards the v2 path did not apply to the one input written before this
      // deploy, which is exactly the input it exists to distrust.
      await expect(store.getSpool({ spoolRef: legacyKey, ...spoolCoords })).rejects.toThrow(
        StreamTooLargeError,
      );
    });
  });
});

describe("getSpool — given an object larger than the read cap", () => {
  describe("when getSpool is called", () => {
    /** @scenario "A spool object larger than the cap is refused rather than buffered" */
    it("rejects instead of buffering it whole", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      // Emitted lazily in 1 MB chunks — the cap should trip long before
      // anything close to MAX_SPOOL_BYTES is actually resident.
      objectStore.read.mockImplementationOnce(async () =>
        Readable.from(
          (function* () {
            for (let sent = 0; sent <= MAX_SPOOL_BYTES; sent += 1024 * 1024) {
              yield Buffer.alloc(1024 * 1024);
            }
          })(),
        ),
      );
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await expect(store.getSpool({ spoolRef: SPOOL_REF_V2, ...spoolCoords })).rejects.toThrow(
        StreamTooLargeError,
      );
    });
  });
});

describe("getSpool — given the object is missing", () => {
  describe("when getSpool is called", () => {
    it("throws rather than returning an empty span", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await expect(store.getSpool({ spoolRef: SPOOL_REF_V2, ...spoolCoords })).rejects.toThrow(
        /NoSuchKey/,
      );
    });
  });
});

describe("deleteSpool — given an existing spool object", () => {
  describe("when deleteSpool is called", () => {
    it("deletes the object it wrote", async () => {
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });
      const spoolRef = await store.putSpool({
        ...spoolCoords,
        body: Buffer.from("to be deleted", "utf-8"),
      });

      await store.deleteSpool({ spoolRef, ...spoolCoords });

      expect(objectStore.deleteKeys).toEqual([SPOOL_SLOT]);
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
      const objectStore = fakeObjectStore(AZURE_DESTINATION);
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: resolverFor(fake) }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await store.deleteSpool({ spoolRef: legacyKey, ...spoolCoords });

      expect(fake.objects.size).toBe(0);
      expect(objectStore.remove).not.toHaveBeenCalled();
    });
  });
});

describe("deleteSpool — given the storage backend rejects the delete", () => {
  describe("when deleteSpool is called", () => {
    it("does not throw (best-effort — the lifecycle rule is the safety net)", async () => {
      const objectStore = fakeObjectStore(S3_DESTINATION);
      objectStore.remove.mockRejectedValueOnce(new Error("AccessDenied"));
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: forbiddenS3Resolver }),
        spoolStorage: spoolStorageFor(objectStore),
      });

      await expect(
        store.deleteSpool({ spoolRef: SPOOL_REF_V2, ...spoolCoords }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("deleteSpool — given a v1 reference naming another tenant", () => {
  describe("when deleteSpool is called", () => {
    /** @scenario "A legacy reference is pinned to the command's own tenant" */
    it("refuses the delete and says so, rather than swallowing it", async () => {
      const fake = fakeS3();
      const victimKey = "trace-blobs/spool/victim-org/trace-1/span-1";
      fake.objects.set(`test-bucket/${victimKey}`, Buffer.from("another tenant's payload"));
      const { logger, lines } = createTestLogger();
      const store = TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: resolverFor(fake) }),
        spoolStorage: spoolStorageFor(fakeObjectStore(S3_DESTINATION)),
        logger,
      });

      await store.deleteSpool({ spoolRef: victimKey, ...spoolCoords });

      expect(fake.objects.size).toBe(1);
      expect(lines.findLine("warn", "Refused a cross-tenant v1 spool delete")).toMatchObject({
        projectId: "orgA",
        traceId: "trace-1",
        spanId: "span-1",
      });
    });
  });
});
