/**
 * Unit tests for StoredObjectsRepository — verifies that queries are
 * project-scoped and that reads decode the positional wire array from the
 * new ClickHouse client.
 */
import type { ClickHouseClient } from "@langwatch/clickhouse";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { StoredObject } from "../stored-object";
import { StoredObjectsRepository } from "../stored-objects.repository";

const COLUMN_NAMES = [
  "id",
  "project_id",
  "purpose",
  "owner_kind",
  "owner_id",
  "media_type",
  "size_bytes",
  "sha256",
  "storage_uri",
  "created_at",
  "inserted_at",
];
const COLUMN_TYPES = [
  "String",
  "String",
  "LowCardinality(String)",
  "LowCardinality(String)",
  "String",
  "String",
  "UInt64",
  "String",
  "String",
  "DateTime64(3)",
  "DateTime64(3)",
];

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

function wireRowFor(row: StoredObject): unknown[] {
  return [
    row.id,
    row.project_id,
    row.purpose,
    row.owner_kind,
    row.owner_id,
    row.media_type,
    String(row.size_bytes),
    row.sha256,
    row.storage_uri,
    "2025-01-01 00:00:00.000",
    "2025-01-01 00:00:00.000",
  ];
}

describe("StoredObjectsRepository", () => {
  let insert: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let command: ReturnType<typeof vi.fn>;
  let resolveClient: Mock<(tenantId: string) => ClickHouseClient>;
  let repo: StoredObjectsRepository;

  beforeEach(() => {
    insert = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [] });
    command = vi.fn().mockResolvedValue(undefined);
    resolveClient = vi.fn(
      (_tenantId: string) =>
        ({ insert, query, command }) as unknown as ClickHouseClient,
    );
    repo = new StoredObjectsRepository(resolveClient);
  });

  describe("insert", () => {
    describe("when called with a projectId and row", () => {
      it("writes the row as a positional array through the new client", async () => {
        const row = makeRow();

        await repo.insert({ projectId: "proj-1", row });

        expect(resolveClient).toHaveBeenCalledWith("proj-1");
        expect(insert).toHaveBeenCalledOnce();
        const call = insert.mock.calls[0]![0];
        expect(call.tenantId).toBe("proj-1");
        expect(call.table).toBe("stored_objects");
        expect(call.columns).toEqual(COLUMN_NAMES);
        expect(call.target).toEqual({ kind: "replacing" });
        expect(call.rows).toEqual([wireRowFor(row)]);
      });
    });
  });

  describe("findById", () => {
    describe("when the row exists in ClickHouse", () => {
      /** @scenario Reads decode the positional row, not a JSON object */
      it("decodes the positional row into a StoredObject, project-scoped", async () => {
        const expected = makeRow();
        query.mockResolvedValue({
          rows: [wireRowFor(expected)],
          header: { names: COLUMN_NAMES, types: COLUMN_TYPES },
        });

        const result = await repo.findById({
          projectId: "proj-1",
          id: "test-id",
        });

        expect(query).toHaveBeenCalledOnce();
        const call = query.mock.calls[0]![0];
        expect(call.tenantId).toBe("proj-1");
        expect(call.params.projectId).toBe("proj-1");
        expect(call.params.id).toBe("test-id");

        expect(result).toEqual(expected);
      });
    });

    describe("when no row matches", () => {
      it("returns null", async () => {
        const result = await repo.findById({
          projectId: "proj-1",
          id: "missing-id",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("findAllByProject", () => {
    it("decodes id/storage_uri pairs, deduped by the IN-tuple pattern", async () => {
      query.mockResolvedValue({
        rows: [["id-1", "s3://bucket/id-1"]],
        header: {
          names: ["id", "storage_uri"],
          types: ["String", "String"],
        },
      });

      const result = await repo.findAllByProject({ projectId: "proj-1" });

      expect(result).toEqual([{ id: "id-1", storage_uri: "s3://bucket/id-1" }]);
      const call = query.mock.calls[0]![0];
      expect(call.params.projectId).toBe("proj-1");
      expect(call.sql).toContain("project_id");
    });
  });

  describe("sumSizeBytesByProject", () => {
    it("decodes the summed UInt64 wire values into numbers", async () => {
      query.mockResolvedValue({
        rows: [["1024", "3"]],
        header: {
          names: ["total_bytes", "object_count"],
          types: ["UInt64", "UInt64"],
        },
      });

      const result = await repo.sumSizeBytesByProject({ projectId: "proj-1" });

      expect(result).toEqual({ totalBytes: 1024, objectCount: 3 });
    });

    it("returns zero when the project has no rows", async () => {
      const result = await repo.sumSizeBytesByProject({ projectId: "proj-1" });

      expect(result).toEqual({ totalBytes: 0, objectCount: 0 });
    });

    it("adds the purpose predicate to both the outer and dedup scopes", async () => {
      query.mockResolvedValue({
        rows: [["512", "1"]],
        header: {
          names: ["total_bytes", "object_count"],
          types: ["UInt64", "UInt64"],
        },
      });

      await repo.sumSizeBytesByProject({
        projectId: "proj-1",
        purpose: "trace_content",
      });

      const call = query.mock.calls[0]![0];
      expect(call.params.purpose).toBe("trace_content");
      expect(call.sql).toContain("t.purpose = {purpose:String}");
    });
  });

  describe("delete methods", () => {
    describe("when deleting every row for a project", () => {
      it("issues the mutation as a project-scoped command with mutations_sync", async () => {
        await repo.deleteByProject({ projectId: "proj-1" });

        expect(resolveClient).toHaveBeenCalledWith("proj-1");
        expect(command).toHaveBeenCalledOnce();
        const request = command.mock.calls[0]![0];
        expect(request.tenantId).toBe("proj-1");
        expect(request.sql).toContain("project_id = {projectId:String}");
        expect(request.params).toEqual({ projectId: "proj-1" });
        expect(request.settings).toEqual({ mutations_sync: "1" });
      });
    });

    describe("when deleting a subset of ids", () => {
      it("issues the mutation as a project-scoped command with mutations_sync", async () => {
        await repo.deleteByIds({ projectId: "proj-1", ids: ["a", "b"] });

        expect(resolveClient).toHaveBeenCalledWith("proj-1");
        expect(command).toHaveBeenCalledOnce();
        const request = command.mock.calls[0]![0];
        expect(request.tenantId).toBe("proj-1");
        expect(request.sql).toContain("project_id = {projectId:String}");
        expect(request.sql).toContain("id IN ({ids:Array(String)})");
        expect(request.params).toEqual({
          projectId: "proj-1",
          ids: ["a", "b"],
        });
        expect(request.settings).toEqual({ mutations_sync: "1" });
      });
    });

    it("is a no-op for an empty id list, without resolving any client", async () => {
      await repo.deleteByIds({ projectId: "proj-1", ids: [] });

      expect(resolveClient).not.toHaveBeenCalled();
    });
  });
});
