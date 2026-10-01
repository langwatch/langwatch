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

// One shared instance rather than a fresh object per call: the module under
// test keeps the logger it was handed at import time, so a per-call factory
// leaves the test holding an object nothing ever writes to.
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ObjectNotFoundError } from "@langwatch/stored-object-contract";

import type { StoredObjectStorageRepository } from "../../repositories/stored-object-storage.repository.ts";
import type { StoredObjectsRepository } from "../../repositories/stored-objects.repository.ts";
import type { StoredObject } from "../../rules/stored-object-row.rules.ts";
import { StoredObjectsService } from "../stored-objects.service.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRepository(): StoredObjectsRepository {
  return { tryFindById: vi.fn().mockResolvedValue(null) };
}

function makeRegistry(): StoredObjectStorageRepository {
  return {
    get: vi.fn().mockResolvedValue(Readable.from([])),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  };
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

const PROJECT_ID = "proj-1";

function makeService({
  repository,
  registry,
}: {
  repository: StoredObjectsRepository;
  registry: StoredObjectStorageRepository;
}): StoredObjectsService {
  return StoredObjectsService.create({
    repository,
    registry,
    telemetry: { recordReadFailure: vi.fn() },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getById", () => {
  let repo: StoredObjectsRepository;
  let registry: StoredObjectStorageRepository;
  let service: StoredObjectsService;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    service = makeService({ repository: repo, registry });
  });

  describe("when the row exists and storage has the bytes", () => {
    it("returns the row and a readable stream", async () => {
      const row = makeRow({ id: "obj-1" });
      const stream = Readable.from(["data"]);
      vi.mocked(repo.tryFindById).mockResolvedValue(row);
      vi.mocked(registry.get).mockResolvedValue(stream);

      const result = await service.getById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).toMatchObject({ row });
      expect((result as { stream: Readable }).stream).toBe(stream);
    });
  });

  describe("when the row exists but storage 404s", () => {
    it("returns row plus status missing", async () => {
      const row = makeRow({ id: "obj-1" });
      vi.mocked(repo.tryFindById).mockResolvedValue(row);
      vi.mocked(registry.get).mockRejectedValue(
        new ObjectNotFoundError("file:///var/lib/langwatch/objects/proj-1/abc"),
      );

      const result = await service.getById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).toMatchObject({ row, status: "missing" });
      expect((result as { status: string }).status).toBe("missing");
    });
  });

  describe("when the row does not exist", () => {
    it("throws the not-found error", async () => {
      vi.mocked(repo.tryFindById).mockResolvedValue(null);

      await expect(
        service.getById({ projectId: PROJECT_ID, id: "unknown-id" }),
      ).rejects.toMatchObject({ code: "stored_object_not_found" });
    });
  });

  describe("when storage throws a non-404 error", () => {
    it("rethrows", async () => {
      const row = makeRow({ id: "obj-1" });
      const networkError = new Error("network timeout");
      vi.mocked(repo.tryFindById).mockResolvedValue(row);
      vi.mocked(registry.get).mockRejectedValue(networkError);

      await expect(service.getById({ projectId: PROJECT_ID, id: "obj-1" })).rejects.toThrow(
        "network timeout",
      );
    });
  });
});

describe("headById", () => {
  let repo: StoredObjectsRepository;
  let registry: StoredObjectStorageRepository;
  let service: StoredObjectsService;

  beforeEach(() => {
    repo = makeRepository();
    registry = makeRegistry();
    service = makeService({ repository: repo, registry });
  });

  describe("when the row exists and storage has the bytes", () => {
    /** @scenario "headById returns a tri-state distinguishing not_found, missing, and available" */
    it("returns status available with the media type", async () => {
      const row = makeRow({ id: "obj-1", media_type: "audio/mp3" });
      vi.mocked(repo.tryFindById).mockResolvedValue(row);
      vi.mocked(registry.exists).mockResolvedValue(true);

      const result = await service.headById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).toEqual({
        status: "available",
        mediaType: "audio/mp3",
        purpose: row.purpose,
      });
    });
  });

  describe("when the row exists but storage reports the blob is gone", () => {
    it("returns status missing with the media type", async () => {
      const row = makeRow({ id: "obj-1", media_type: "audio/mp3" });
      vi.mocked(repo.tryFindById).mockResolvedValue(row);
      vi.mocked(registry.exists).mockResolvedValue(false);

      const result = await service.headById({
        projectId: PROJECT_ID,
        id: "obj-1",
      });

      expect(result).toEqual({
        status: "missing",
        mediaType: "audio/mp3",
        purpose: row.purpose,
      });
    });
  });

  describe("when the row does not exist", () => {
    it("returns status not_found and does not probe storage", async () => {
      vi.mocked(repo.tryFindById).mockResolvedValue(null);

      const result = await service.headById({
        projectId: PROJECT_ID,
        id: "unknown",
      });

      expect(result).toEqual({ status: "not_found" });
      expect(registry.exists).not.toHaveBeenCalled();
    });
  });
});
