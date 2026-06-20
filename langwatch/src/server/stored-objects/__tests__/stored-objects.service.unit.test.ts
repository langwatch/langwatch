/**
 * @vitest-environment node
 *
 * Unit tests for StoredObjectsService with mocked repository and registry.
 */
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module load
// ---------------------------------------------------------------------------

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      // withActiveSpan(name, fn) or withActiveSpan(name, options, fn)
      const fn = args.length === 1 ? args[0] : args[1];
      const span: { setAttribute: ReturnType<typeof vi.fn> } = {
        setAttribute: vi.fn(),
      };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    S3_BUCKET_NAME: undefined,
  },
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// mintStorageUri calls getS3ConfigForProject to resolve the per-project
// dataplane bucket (BYOC fix). The unit test never wires Prisma so we
// stub the lookup to always return null — that path falls through to
// env.S3_BUCKET_NAME (also mocked above to an empty string), and the
// service ends up minting file:// URIs. The integration test exercises
// the real lookup with testcontainers.
vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { env as mockedEnv } from "~/env.mjs";
import * as dataplaneS3 from "~/server/dataplane-s3";
import { ObjectNotFoundError } from "../errors";
import type { StorageRegistry } from "../storage-registry";
import type { StoredObject } from "../stored-object";
import type { StoredObjectsRepository } from "../stored-objects.repository";
import type { MintStorageUri } from "../stored-objects.service";
import {
  deriveStoredObjectId,
  StoredObjectsService,
} from "../stored-objects.service";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRepository(): StoredObjectsRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findAllByProject: vi.fn().mockResolvedValue([]),
    deleteByProject: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
  } as unknown as StoredObjectsRepository;
}

function makeRegistry(): StorageRegistry {
  return {
    get: vi.fn().mockResolvedValue(Readable.from([])),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  } as unknown as StorageRegistry;
}

function makeRow(overrides: Partial<StoredObject> = {}): StoredObject {
  return {
    id: "test-id",
    project_id: "proj-1",
    purpose: "trace_content",
    owner_kind: "span",
    owner_id: "owner-1",
    media_type: "text/plain",
    size_bytes: 5,
    sha256: "abc123",
    storage_uri: "file:///var/lib/langwatch/objects/proj-1/abc123",
    created_at: new Date("2025-01-01T00:00:00Z"),
    inserted_at: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

const TEST_BYTES = Buffer.from("hello");
const PROJECT_ID = "proj-1";
const STORE_PARAMS = {
  projectId: PROJECT_ID,
  purpose: "trace_content",
  ownerKind: "span",
  ownerId: "owner-1",
  mediaType: "text/plain",
  bytes: TEST_BYTES,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("storeFromBytes", () => {
  let repo: StoredObjectsRepository;
  let registry: StorageRegistry;
  let service: StoredObjectsService;
  let mockMintStorageUri: ReturnType<typeof vi.fn> & MintStorageUri;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    mockMintStorageUri = vi.fn(
      async ({ projectId, sha256 }: { projectId: string; sha256: string }) =>
        `file:///tmp/${projectId}/${sha256}`,
    ) as ReturnType<typeof vi.fn> & MintStorageUri;
    service = new StoredObjectsService(repo, registry, mockMintStorageUri);
  });

  describe("when the content is new for the project", () => {
    it("PUTs bytes to storage, INSERTs a stored_objects row, returns the new id with isDuplicate false", async () => {
      const result = await service.storeFromBytes(STORE_PARAMS);

      expect(registry.put).toHaveBeenCalledOnce();
      expect(registry.put).toHaveBeenCalledWith(
        expect.stringContaining("proj-1"),
        TEST_BYTES,
        "text/plain",
      );

      expect(repo.insert).toHaveBeenCalledOnce();
      const insertCall = vi.mocked(repo.insert).mock.calls[0]![0];
      expect(insertCall.projectId).toBe(PROJECT_ID);
      expect(insertCall.row.project_id).toBe(PROJECT_ID);
      expect(insertCall.row.purpose).toBe("trace_content");
      expect(insertCall.row.media_type).toBe("text/plain");
      expect(insertCall.row.size_bytes).toBe(TEST_BYTES.length);

      expect(result.isDuplicate).toBe(false);
      expect(result.mediaType).toBe("text/plain");
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
    });
  });

  describe("when identical content already exists for the project", () => {
    it("returns the existing id with isDuplicate true and does not call storage put or repository insert", async () => {
      const existingId = "existing-uuid";
      vi.mocked(repo.findById).mockResolvedValue(makeRow({ id: existingId }));

      const result = await service.storeFromBytes(STORE_PARAMS);

      expect(registry.put).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();

      expect(result.id).toBe(existingId);
      expect(result.isDuplicate).toBe(true);
      expect(result.mediaType).toBe("text/plain");
    });

    it("dedup probe goes through findById (by deterministic id), not by sha256 — a regression to the scan-all-partitions path would surface here", async () => {
      // Lock the dedup-probe contract: the hot path computes id = derive(projectId, sha256)
      // and looks up via findById. findById uses the (project_id, id) primary key seek;
      // the old sha256 path scanned every weekly partition incl. cold S3.
      vi.mocked(repo.findById).mockResolvedValue(null);

      await service.storeFromBytes(STORE_PARAMS);

      expect(repo.findById).toHaveBeenCalledOnce();
      const call = vi.mocked(repo.findById).mock.calls[0]![0];
      expect(call.projectId).toBe(PROJECT_ID);
      expect(typeof call.id).toBe("string");
      expect(call.id.length).toBeGreaterThan(0);
    });
  });

  describe("when storage put fails", () => {
    it("throws and does not insert any stored_objects row", async () => {
      const storageError = new Error("S3 unavailable");
      vi.mocked(registry.put).mockRejectedValue(storageError);

      await expect(service.storeFromBytes(STORE_PARAMS)).rejects.toThrow(
        "S3 unavailable",
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe("when the repository insert fails after a successful storage put", () => {
    /** @scenario "DB insert failure after a successful storage PUT triggers compensating storage delete" */
    it("issues a compensating storage delete and surfaces the original error to the caller", async () => {
      // Setup: storage PUT succeeds, repository INSERT throws.
      const chError = new Error("ClickHouse insert failed");
      vi.mocked(repo.insert).mockRejectedValueOnce(chError);

      // Capture the URI that was used for PUT so we can assert the
      // compensating delete targets exactly the same URI.
      let putUri: string | undefined;
      vi.mocked(registry.put).mockImplementation(async (uri: string) => {
        putUri = uri;
      });

      await expect(service.storeFromBytes(STORE_PARAMS)).rejects.toThrow(
        "ClickHouse insert failed",
      );

      // Storage was attempted (so the compensating delete makes sense)
      expect(registry.put).toHaveBeenCalledOnce();
      expect(putUri).toBeDefined();

      // The compensating delete fires at the same URI we just wrote to.
      // Without it the bytes would orphan in S3/disk with no row pointing
      // to them — a measurable storage leak under retried 5xx scenarios.
      expect(registry.delete).toHaveBeenCalledWith(putUri);
    });
  });

  describe("when the ClickHouse insert returns an error (case from CH async_insert path)", () => {
    /** @scenario "ClickHouse insert errors surface synchronously to the caller" */
    it("the service rejects with the underlying error and does not swallow", async () => {
      // The repository wraps ClickHouse `client.insert()` with the
      // `wait_for_async_insert=1` setting (configured in
      // stored-objects.repository.ts) precisely so that CH errors come
      // back to the caller synchronously instead of being silently
      // dropped on the async_insert queue. The service must surface that
      // error untouched — no try/catch swallow, no degraded fallback.
      const chError = new Error("DB::NetException: connection refused");
      vi.mocked(repo.insert).mockRejectedValueOnce(chError);

      await expect(service.storeFromBytes(STORE_PARAMS)).rejects.toThrow(
        "DB::NetException: connection refused",
      );
    });
  });

  describe("when called twice with identical input", () => {
    it("returns the same deterministic id", async () => {
      // First call: miss → store
      const first = await service.storeFromBytes(STORE_PARAMS);

      // Second call: simulated hit (real world) — but we want to verify
      // determinism so we call storeFromBytes again with a miss too
      const second = await service.storeFromBytes(STORE_PARAMS);

      expect(first.id).toBe(second.id);
    });
  });

  describe("when called from two pods concurrently with identical input", () => {
    /** @scenario "Stored object id is deterministic so concurrent ingest of the same content collapses cleanly" */
    it("both compute the same id from project_id and sha256", () => {
      // The id is derived purely from (projectId, sha256) — no randomness.
      // Simulating two concurrent pods means calling deriveStoredObjectId
      // with the same inputs twice and verifying they produce the same result.
      const sha256 = "e2d0fe1585a63ec6009c8016ff8dda8b17719a637405a4e23c0536d6";

      const idFromPod1 = deriveStoredObjectId({
        projectId: PROJECT_ID,
        sha256,
      });
      const idFromPod2 = deriveStoredObjectId({
        projectId: PROJECT_ID,
        sha256,
      });

      expect(idFromPod1).toBe(idFromPod2);
      // Must look like a KSUID: resource_<29-char-base62>
      expect(idFromPod1).toMatch(/^so_[0-9A-Za-z]{29}$/);
    });
  });
});

describe("getById", () => {
  let repo: StoredObjectsRepository;
  let registry: StorageRegistry;
  let service: StoredObjectsService;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    const mintStub: MintStorageUri = async ({ projectId, sha256 }) =>
      `file:///tmp/${projectId}/${sha256}`;
    service = new StoredObjectsService(repo, registry, mintStub);
  });

  describe("when the row exists and storage has the bytes", () => {
    it("returns the row and a readable stream", async () => {
      const row = makeRow({ id: "obj-1" });
      const stream = Readable.from(["data"]);
      vi.mocked(repo.findById).mockResolvedValue(row);
      vi.mocked(registry.get).mockResolvedValue(stream);

      const result = await service.getById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ row });
      expect((result as { stream: Readable }).stream).toBe(stream);
    });
  });

  describe("when the row exists but storage 404s", () => {
    it("returns row plus status missing", async () => {
      const row = makeRow({ id: "obj-1" });
      vi.mocked(repo.findById).mockResolvedValue(row);
      vi.mocked(registry.get).mockRejectedValue(
        new ObjectNotFoundError("file:///var/lib/langwatch/objects/proj-1/abc"),
      );

      const result = await service.getById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ row, status: "missing" });
      expect((result as { status: string }).status).toBe("missing");
    });
  });

  describe("when the row does not exist", () => {
    it("returns null", async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const result = await service.getById({
        projectId: PROJECT_ID,
        id: "unknown-id",
      });

      expect(result).toBeNull();
    });
  });

  describe("when storage throws a non-404 error", () => {
    it("rethrows", async () => {
      const row = makeRow({ id: "obj-1" });
      const networkError = new Error("network timeout");
      vi.mocked(repo.findById).mockResolvedValue(row);
      vi.mocked(registry.get).mockRejectedValue(networkError);

      await expect(
        service.getById({ projectId: PROJECT_ID, id: "obj-1" }),
      ).rejects.toThrow("network timeout");
    });
  });
});

describe("deleteOwnedBy", () => {
  let repo: StoredObjectsRepository;
  let registry: StorageRegistry;
  let service: StoredObjectsService;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    const mintStub: MintStorageUri = async ({ projectId, sha256 }) =>
      `file:///tmp/${projectId}/${sha256}`;
    service = new StoredObjectsService(repo, registry, mintStub);
  });

  describe("when every byte-delete succeeds", () => {
    it("deletes every row in one batch", async () => {
      const rows = [makeRow({ id: "obj-1" }), makeRow({ id: "obj-2" })];
      vi.mocked(repo.findAllByProject).mockResolvedValue(rows);
      vi.mocked(registry.delete).mockResolvedValue(undefined);

      await service.deleteOwnedBy({ projectId: PROJECT_ID });

      expect(registry.delete).toHaveBeenCalledTimes(2);
      expect(repo.deleteByIds).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        ids: ["obj-1", "obj-2"],
      });
      // The old whole-project DELETE path must NOT be used — see retention contract.
      expect(repo.deleteByProject).not.toHaveBeenCalled();
    });
  });

  describe("when some byte-deletes fail", () => {
    it("retains the failed rows as retryable tombstones and only deletes the succeeded ones", async () => {
      const rows = [
        makeRow({ id: "obj-ok" }),
        makeRow({ id: "obj-broken" }),
        makeRow({ id: "obj-also-ok" }),
      ];
      vi.mocked(repo.findAllByProject).mockResolvedValue(rows);
      vi.mocked(registry.delete)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("storage timeout"))
        .mockResolvedValueOnce(undefined);

      await service.deleteOwnedBy({ projectId: PROJECT_ID });

      // Only the succeeded ids are passed to deleteByIds — the broken row's
      // id is retained in CH so a future cascade can retry the byte-delete.
      expect(repo.deleteByIds).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        ids: ["obj-ok", "obj-also-ok"],
      });
      // The failed row's id MUST NOT be in the delete list — losing it would
      // strand the bytes with no row pointing at the storage_uri.
      const passedIds = vi.mocked(repo.deleteByIds).mock.calls[0]?.[0].ids;
      expect(passedIds).not.toContain("obj-broken");
    });
  });

  describe("when every byte-delete fails", () => {
    it("does not call deleteByIds at all — every row is retained for retry", async () => {
      const rows = [makeRow({ id: "obj-a" }), makeRow({ id: "obj-b" })];
      vi.mocked(repo.findAllByProject).mockResolvedValue(rows);
      vi.mocked(registry.delete).mockRejectedValue(new Error("backend down"));

      await service.deleteOwnedBy({ projectId: PROJECT_ID });

      expect(repo.deleteByIds).not.toHaveBeenCalled();
      expect(repo.deleteByProject).not.toHaveBeenCalled();
    });
  });

  describe("when the project has no stored objects", () => {
    it("returns without touching storage or the repository delete methods", async () => {
      vi.mocked(repo.findAllByProject).mockResolvedValue([]);

      await service.deleteOwnedBy({ projectId: PROJECT_ID });

      expect(registry.delete).not.toHaveBeenCalled();
      expect(repo.deleteByIds).not.toHaveBeenCalled();
    });
  });
});

describe("headById", () => {
  let repo: StoredObjectsRepository;
  let registry: StorageRegistry;
  let service: StoredObjectsService;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    const mintStub: MintStorageUri = async ({ projectId, sha256 }) =>
      `file:///tmp/${projectId}/${sha256}`;
    service = new StoredObjectsService(repo, registry, mintStub);
  });

  describe("when the row exists and storage has the bytes", () => {
    /** @scenario "headById returns a tri-state distinguishing not_found, missing, and available" */
    it("returns status available with the media type", async () => {
      const row = makeRow({ id: "obj-1", media_type: "audio/mp3" });
      vi.mocked(repo.findById).mockResolvedValue(row);
      vi.mocked(registry.exists).mockResolvedValue(true);

      const result = await service.headById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).toEqual({ status: "available", mediaType: "audio/mp3" });
    });
  });

  describe("when the row exists but storage reports the blob is gone", () => {
    it("returns status missing with the media type", async () => {
      const row = makeRow({ id: "obj-1", media_type: "audio/mp3" });
      vi.mocked(repo.findById).mockResolvedValue(row);
      vi.mocked(registry.exists).mockResolvedValue(false);

      const result = await service.headById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).toEqual({ status: "missing", mediaType: "audio/mp3" });
    });
  });

  describe("when the row does not exist", () => {
    it("returns status not_found and does not probe storage", async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const result = await service.headById({
        projectId: PROJECT_ID,
        id: "unknown",
      });

      expect(result).toEqual({ status: "not_found" });
      expect(registry.exists).not.toHaveBeenCalled();
    });
  });
});

describe("mintStorageUri (BYOC bucket selection — observed through the inserted row)", () => {
  let repo: StoredObjectsRepository;
  let registry: StorageRegistry;
  let service: StoredObjectsService;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    service = new StoredObjectsService(repo, registry);
  });

  describe("when the project has a private dataplane bucket configured", () => {
    /** @scenario "For a project with a per-project private dataplane bucket, mintStorageUri uses the project bucket, not the global one" */
    it("mints the URI under the project bucket and ignores the global S3_BUCKET_NAME", async () => {
      // Project A has its own bucket. The dataplane lookup returns it.
      vi.mocked(dataplaneS3.getS3ConfigForProject).mockResolvedValueOnce({
        bucket: "dataplane-acme",
        endpoint: "https://s3.amazonaws.com",
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
      });
      // Even though a global is set, the per-project value wins.
      (mockedEnv as { S3_BUCKET_NAME?: string }).S3_BUCKET_NAME =
        "langwatch-storage-prod";

      try {
        await service.storeFromBytes(STORE_PARAMS);
      } finally {
        (mockedEnv as { S3_BUCKET_NAME?: string }).S3_BUCKET_NAME = undefined;
      }

      // Storage URI used for both the PUT and the inserted row points to
      // the per-project bucket, never the global one.
      expect(registry.put).toHaveBeenCalledOnce();
      const putUri = vi.mocked(registry.put).mock.calls[0]![0];
      expect(putUri).toMatch(/^s3:\/\/dataplane-acme\//);
      expect(putUri).not.toMatch(/langwatch-storage-prod/);

      const insertedRow = vi.mocked(repo.insert).mock.calls[0]![0].row;
      expect(insertedRow.storage_uri).toMatch(/^s3:\/\/dataplane-acme\//);
    });
  });

  describe("when the project has no private bucket but a global S3_BUCKET_NAME is set", () => {
    /** @scenario "For a project without per-project storage configured, mintStorageUri falls back to the global S3_BUCKET_NAME" */
    it("mints the URI under the global bucket so the storage_uri matches what the read path will use", async () => {
      vi.mocked(dataplaneS3.getS3ConfigForProject).mockResolvedValueOnce(null);
      (mockedEnv as { S3_BUCKET_NAME?: string }).S3_BUCKET_NAME =
        "langwatch-storage-prod";

      try {
        await service.storeFromBytes(STORE_PARAMS);
      } finally {
        (mockedEnv as { S3_BUCKET_NAME?: string }).S3_BUCKET_NAME = undefined;
      }

      const putUri = vi.mocked(registry.put).mock.calls[0]![0];
      expect(putUri).toMatch(/^s3:\/\/langwatch-storage-prod\//);

      // The row's storage_uri is the authoritative read address (BYOC
      // invariant) — it must match what we just wrote to.
      const insertedRow = vi.mocked(repo.insert).mock.calls[0]![0].row;
      expect(insertedRow.storage_uri).toBe(putUri);
    });
  });
});

describe("StoredObjectsService surface", () => {
  /** @scenario "StoredObjectsService exposes storeFromBytes, getById, headById, deleteOwnedBy" */
  it("exposes storeFromBytes, getById, deleteOwnedBy", () => {
    const mintStub: MintStorageUri = async ({ projectId, sha256 }) =>
      `file:///tmp/${projectId}/${sha256}`;
    const service = new StoredObjectsService(
      makeRepository(),
      makeRegistry(),
      mintStub,
    );

    expect(typeof service.storeFromBytes).toBe("function");
    expect(typeof service.getById).toBe("function");
    expect(typeof service.headById).toBe("function");
    expect(typeof service.deleteOwnedBy).toBe("function");
  });
});
