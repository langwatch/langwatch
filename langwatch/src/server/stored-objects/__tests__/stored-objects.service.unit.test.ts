/**
 * @vitest-environment node
 *
 * Unit tests for StoredObjectsService with mocked repository and registry.
 */
import { Readable } from "node:stream";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module load
// ---------------------------------------------------------------------------

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      ...args: unknown[]
    ) => {
      // withActiveSpan(name, fn) or withActiveSpan(name, options, fn)
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: vi.fn() };
      return (fn as (span: typeof span) => Promise<unknown>)(span);
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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { StoredObject } from "../stored-object";
import type { StoredObjectsRepository } from "../stored-objects.repository";
import { StoredObjectsService, deriveStoredObjectId } from "../stored-objects.service";
import type { StorageRegistry } from "../storage-registry";
import { ObjectNotFoundError } from "../errors";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRepository(): StoredObjectsRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findBySha256: vi.fn().mockResolvedValue(null),
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

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    service = new StoredObjectsService(repo, registry);
  });

  describe("when the content is new for the project", () => {
    it("PUTs bytes to storage, INSERTs a stored_objects row, returns the new id with isDuplicate false", async () => {
      vi.mocked(repo.findBySha256).mockResolvedValue(null);

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
      vi.mocked(repo.findBySha256).mockResolvedValue({ id: existingId });

      const result = await service.storeFromBytes(STORE_PARAMS);

      expect(registry.put).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();

      expect(result.id).toBe(existingId);
      expect(result.isDuplicate).toBe(true);
      expect(result.mediaType).toBe("text/plain");
    });
  });

  describe("when storage put fails", () => {
    it("throws and does not insert any stored_objects row", async () => {
      const storageError = new Error("S3 unavailable");
      vi.mocked(repo.findBySha256).mockResolvedValue(null);
      vi.mocked(registry.put).mockRejectedValue(storageError);

      await expect(service.storeFromBytes(STORE_PARAMS)).rejects.toThrow("S3 unavailable");
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe("when called twice with identical input", () => {
    it("returns the same deterministic id", async () => {
      // First call: miss → store
      vi.mocked(repo.findBySha256).mockResolvedValueOnce(null);
      const first = await service.storeFromBytes(STORE_PARAMS);

      // Second call: simulated hit (real world) — but we want to verify
      // determinism so we call storeFromBytes again with a miss too
      vi.mocked(repo.findBySha256).mockResolvedValueOnce(null);
      const second = await service.storeFromBytes(STORE_PARAMS);

      expect(first.id).toBe(second.id);
    });
  });

  describe("when called from two pods concurrently with identical input", () => {
    it("both compute the same id from project_id and sha256", () => {
      // The id is derived purely from (projectId, sha256) — no randomness.
      // Simulating two concurrent pods means calling deriveStoredObjectId
      // with the same inputs twice and verifying they produce the same result.
      const sha256 = "e2d0fe1585a63ec6009c8016ff8dda8b17719a637405a4e23c0536d6";

      const idFromPod1 = deriveStoredObjectId({ projectId: PROJECT_ID, sha256 });
      const idFromPod2 = deriveStoredObjectId({ projectId: PROJECT_ID, sha256 });

      expect(idFromPod1).toBe(idFromPod2);
      // Must look like a UUID
      expect(idFromPod1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
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
    service = new StoredObjectsService(repo, registry);
  });

  describe("when the row exists and storage has the bytes", () => {
    it("returns the row and a readable stream", async () => {
      const row = makeRow({ id: "obj-1" });
      const stream = Readable.from(["data"]);
      vi.mocked(repo.findById).mockResolvedValue(row);
      vi.mocked(registry.get).mockResolvedValue(stream);

      const result = await service.getById({ projectId: PROJECT_ID, id: "obj-1" });

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

      const result = await service.getById({ projectId: PROJECT_ID, id: "obj-1" });

      expect(result).not.toBeNull();
      expect(result).toMatchObject({ row, status: "missing" });
      expect((result as { status: string }).status).toBe("missing");
    });
  });

  describe("when the row does not exist", () => {
    it("returns null", async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const result = await service.getById({ projectId: PROJECT_ID, id: "unknown-id" });

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

describe("StoredObjectsService surface", () => {
  it("exposes storeFromBytes, getById, cascadeDeleteProject, cascadeDeleteOwner", () => {
    const service = new StoredObjectsService(makeRepository(), makeRegistry());

    expect(typeof service.storeFromBytes).toBe("function");
    expect(typeof service.getById).toBe("function");
    expect(typeof service.cascadeDeleteProject).toBe("function");
    expect(typeof service.cascadeDeleteOwner).toBe("function");
  });
});
