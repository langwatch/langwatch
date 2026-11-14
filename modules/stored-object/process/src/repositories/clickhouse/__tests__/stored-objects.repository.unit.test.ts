/**
 * Unit tests for StoredObjectsRepository — verifies that the lookup is a built reader statement
 * scoped to its project and keyed on the table's own tenant column, project_id.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockQuery, mockRead } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRead: vi.fn(),
}));

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
    return { read: mockRead, query: mockQuery };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StoredObjectsRepository", () => {
  let repo: ClickHouseStoredObjectsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRead.mockResolvedValue({ rows: [] });
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
        mockRead.mockResolvedValue({ rows: [rawRow] });

        const result = await repo.tryFindById({
          projectId: "proj-1",
          id: "test-id",
        });

        expect(mockRead).toHaveBeenCalledOnce();
        const { statement } = mockRead.mock.calls[0]![0];
        // The read must be project-scoped
        expect(Object.values(statement.params)).toEqual(
          expect.arrayContaining(["proj-1", "test-id"]),
        );
        expect(statement.sql).toContain("project_id");
        expect(mockQuery).not.toHaveBeenCalled();

        expect(result).not.toBeNull();
        expect(result!.id).toBe("test-id");
        expect(result!.project_id).toBe("proj-1");
        expect(result!.size_bytes).toBe(5);
      });
    });

    describe("when no row matches", () => {
      it("returns null", async () => {
        const result = await repo.tryFindById({
          projectId: "proj-1",
          id: "missing-id",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("when the lookup is sent against a table keyed on project_id", () => {
    const tenantId = "proj-1";

    /** @scenario "The legacy index lookup is a reader statement bounded by its project" */
    it("is a reader statement whose tenant setting is that project, with no skip-check flag", async () => {
      await repo.tryFindById({ projectId: tenantId, id: "x" });

      expect(mockRead).toHaveBeenCalledOnce();
      const request = mockRead.mock.calls[0]![0];
      const { statement } = request;
      expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId });
      expect(statement.tenantColumns).toEqual(["project_id"]);
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: tenantId });
      expect(statement.sql).toContain("project_id = {tenantId:String}");
      expect(request).not.toHaveProperty("SKIP_TENANT_CHECK");
      const sent = { tenantId, sql: statement.sql, params: statement.params };
      expect(() =>
        new TenantGuard().assert(sent, { tenantColumns: statement.tenantColumns }),
      ).not.toThrow();
      expect(() => new TenantGuard().assert(sent)).toThrow(TenantScopeError);
    });
  });
});
