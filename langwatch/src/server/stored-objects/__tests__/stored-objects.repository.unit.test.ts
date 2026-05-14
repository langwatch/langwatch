/**
 * @vitest-environment node
 *
 * Unit tests for StoredObjectsRepository — verifies that queries are
 * project-scoped and that insert/findById/findBySha256 delegate to the
 * ClickHouse client with the expected shape.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockInsert, mockQuery, mockQueryResult } = vi.hoisted(() => {
  const mockQueryResult = {
    json: vi.fn().mockResolvedValue([]),
  };
  return {
    mockInsert: vi.fn().mockResolvedValue(undefined),
    mockQuery: vi.fn().mockResolvedValue(mockQueryResult),
    mockQueryResult,
  };
});

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ insert: mockInsert, query: mockQuery }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      ...args: unknown[]
    ) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span: { setAttribute: ReturnType<typeof vi.fn> } = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { StoredObject } from "../stored-object";
import { StoredObjectsRepository } from "../stored-objects.repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(): StoredObject {
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StoredObjectsRepository", () => {
  let repo: StoredObjectsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult.json.mockResolvedValue([]);
    repo = new StoredObjectsRepository();
  });

  describe("insert", () => {
    describe("when called with a projectId and row", () => {
      it("calls client.insert with the expected table and values", async () => {
        const row = makeRow();

        await repo.insert({ projectId: "proj-1", row });

        expect(mockInsert).toHaveBeenCalledOnce();
        const call = mockInsert.mock.calls[0]![0];
        expect(call.table).toBe("stored_objects");
        expect(call.format).toBe("JSONEachRow");
        expect(call.values).toHaveLength(1);
        expect(call.values[0]).toMatchObject({
          id: row.id,
          project_id: row.project_id,
          sha256: row.sha256,
          storage_uri: row.storage_uri,
        });
      });
    });
  });

  describe("findById", () => {
    describe("when the row exists in ClickHouse", () => {
      it("returns the parsed StoredObject with project_id scoping", async () => {
        const rawRow = {
          id: "test-id",
          project_id: "proj-1",
          purpose: "trace_content",
          owner_kind: "span",
          owner_id: "owner-1",
          media_type: "text/plain",
          size_bytes: "5",
          sha256: "abc123",
          storage_uri: "file:///var/lib/langwatch/objects/proj-1/abc123",
          created_at: "2025-01-01 00:00:00.000",
          inserted_at: "2025-01-01 00:00:00.000",
        };
        mockQueryResult.json.mockResolvedValue([rawRow]);

        const result = await repo.findById({ projectId: "proj-1", id: "test-id" });

        expect(mockQuery).toHaveBeenCalledOnce();
        const call = mockQuery.mock.calls[0]![0];
        // Query must be project-scoped
        expect(call.query_params).toMatchObject({ projectId: "proj-1", id: "test-id" });
        expect(call.query).toContain("project_id");

        expect(result).not.toBeNull();
        expect(result!.id).toBe("test-id");
        expect(result!.project_id).toBe("proj-1");
        expect(result!.size_bytes).toBe(5);
      });
    });

    describe("when no row matches", () => {
      it("returns null", async () => {
        mockQueryResult.json.mockResolvedValue([]);

        const result = await repo.findById({ projectId: "proj-1", id: "missing-id" });

        expect(result).toBeNull();
      });
    });
  });

  describe("findBySha256", () => {
    describe("when a row with the given sha256 exists", () => {
      it("returns the id", async () => {
        mockQueryResult.json.mockResolvedValue([{ id: "found-id" }]);

        const result = await repo.findBySha256({ projectId: "proj-1", sha256: "abc123" });

        expect(mockQuery).toHaveBeenCalledOnce();
        const call = mockQuery.mock.calls[0]![0];
        // Query must be project-scoped
        expect(call.query_params).toMatchObject({ projectId: "proj-1", sha256: "abc123" });
        expect(call.query).toContain("project_id");

        expect(result).toEqual({ id: "found-id" });
      });
    });

    describe("when no row matches", () => {
      it("returns null", async () => {
        mockQueryResult.json.mockResolvedValue([]);

        const result = await repo.findBySha256({ projectId: "proj-1", sha256: "unknown" });

        expect(result).toBeNull();
      });
    });
  });
});
