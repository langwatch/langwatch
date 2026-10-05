/**
 * Unit tests for StoredObjectsRepository — verifies that the lookup is project-scoped and
 * delegates to the ClickHouse client with the expected shape.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockQuery, mockQueryResult } = vi.hoisted(() => {
  const queryResult = {
    json: vi.fn().mockResolvedValue([]),
  };
  return {
    mockQuery: vi.fn().mockResolvedValue(queryResult),
    mockQueryResult: queryResult,
  };
});

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span: { setAttribute: ReturnType<typeof vi.fn> } = {
        setAttribute: vi.fn(),
      };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { TenantGuard, TenantScopeError } from "@langwatch/clickhouse-client";

import type { StoredObjectsClickHouse } from "../stored-objects.repository.ts";
import { ClickHouseStoredObjectsRepository } from "../stored-objects.repository.ts";

/** The routed connection, as this suite's one project resolves it. */
class FakeStoredObjectsClickHouse implements StoredObjectsClickHouse {
  async resolveClient() {
    return { query: mockQuery };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StoredObjectsRepository", () => {
  let repo: ClickHouseStoredObjectsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult.json.mockResolvedValue([]);
    repo = ClickHouseStoredObjectsRepository.create(new FakeStoredObjectsClickHouse());
  });

  describe("tryFindById()", () => {
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

        const result = await repo.tryFindById({
          projectId: "proj-1",
          id: "test-id",
        });

        expect(mockQuery).toHaveBeenCalledOnce();
        const call = mockQuery.mock.calls[0]![0];
        // Query must be project-scoped
        expect(call.query_params).toMatchObject({
          projectId: "proj-1",
          id: "test-id",
        });
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

        const result = await repo.tryFindById({
          projectId: "proj-1",
          id: "missing-id",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("when the lookup is sent against a table with no TenantId column", () => {
    const tenantId = "proj-1";

    /** @scenario "Every legacy index statement declares itself unscoped" */
    it("declares itself unscoped, or the tenant guard refuses it", async () => {
      mockQueryResult.json.mockResolvedValue([]);
      await repo.tryFindById({ projectId: tenantId, id: "x" });

      expect(mockQuery).toHaveBeenCalledOnce();
      const call = mockQuery.mock.calls[0]![0];
      const request = { tenantId, sql: call.query, params: call.query_params };
      expect(() => new TenantGuard().assert(request)).toThrow(TenantScopeError);
      expect(() => new TenantGuard().assert({ ...request, unscoped: call.unscoped })).not.toThrow();
      expect(call.query).toContain("project_id = {projectId:String}");
    });
  });
});
