/**
 * The legacy index page query: a built reader statement bounded by its project, where no alias
 * shadows a column it filters or aggregates by (ClickHouse's ILLEGAL_AGGREGATION, WEB-9100).
 * @vitest-environment node
 */
import { TenantGuard, TenantScopeError } from "@langwatch/clickhouse-client";
import { describe, expect, it, vi } from "vitest";

import { ClickHouseStoredObjectLegacySourceRepository } from "../clickhouse.stored-object-legacy-source.repository.ts";
import type { StoredObjectsClickHouse } from "../stored-objects.repository.ts";

const DAY_MS = 86_400_000;

const ROW = {
  id: "obj-1",
  latest_purpose: "trace_content",
  latest_owner_kind: "span",
  latest_owner_id: "owner-1",
  latest_media_type: "text/plain",
  latest_size_bytes: "5",
  latest_sha256: "abc123",
  latest_storage_uri: "file:///objects/proj-1/abc123",
  latest_created_at: "2025-01-01 00:00:00.000",
  last_inserted_at: "2025-01-02 00:00:00.000",
};

function repositoryAnswering(rows: unknown[]) {
  const read = vi.fn(async (_request: Parameters<StoredObjectsClient["read"]>[0]) => ({
    rows: JSON.parse(JSON.stringify(rows)),
  }));
  class FakeStoredObjectsClickHouse implements StoredObjectsClickHouse {
    async resolveClient() {
      return { read };
    }
  }
  const repository = ClickHouseStoredObjectLegacySourceRepository.create(
    new FakeStoredObjectsClickHouse(),
  );
  return { read, repository };
}

type StoredObjectsClient = Awaited<ReturnType<StoredObjectsClickHouse["resolveClient"]>>;

async function sentRequest(input: { afterId?: string } = {}) {
  const { read, repository } = repositoryAnswering([]);
  await repository.findPage({ projectId: "proj-1", limit: 10, ...input });
  const request = read.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("the page sent no read");
  return request;
}

describe("given a project's legacy stored-object index", () => {
  describe("when the import pages it", () => {
    it("never aliases an aggregate as a column of the table", async () => {
      const { statement } = await sentRequest();

      expect(statement.sql).not.toMatch(
        /AS\s+`?(project_id|inserted_at|purpose|owner_kind|owner_id|media_type|size_bytes|sha256|storage_uri|created_at)`?\b/,
      );
    });

    /** @scenario "The legacy index import is a reader statement bounded by its project" */
    it("is a reader statement whose tenant setting is that project, with no skip-check flag", async () => {
      const request = await sentRequest({ afterId: "obj-0" });
      const { statement } = request;

      expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "proj-1" });
      if (statement.kind !== "tenant") throw new Error("the page is not a tenant statement");
      expect(statement.tenantColumns).toEqual(["project_id"]);
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "proj-1" });
      expect(statement.sql).toContain("project_id = {tenantId:String}");
      expect(Object.values(statement.params)).toEqual(expect.arrayContaining(["proj-1", "obj-0"]));
      expect(request).not.toHaveProperty("SKIP_TENANT_CHECK");
      const sent = { tenantId: "proj-1", sql: statement.sql, params: statement.params };
      expect(() =>
        new TenantGuard().assert(sent, { tenantColumns: statement.tenantColumns }),
      ).not.toThrow();
      expect(() => new TenantGuard().assert(sent)).toThrow(TenantScopeError);
    });

    it("declares the whole-index read, so it raises no cold-scan warning", async () => {
      const request = await sentRequest();

      expect(request.declaresFullScan).toBe(true);
    });

    it("pages from the start when no id is given", async () => {
      const { statement } = await sentRequest();

      expect(Object.values(statement.params)).toContain("");
      expect(statement.sql).toMatch(/GROUP BY[\s\S]*ORDER BY[\s\S]*LIMIT 10\b/);
    });

    it("maps each row to the paged project and its latest insert", async () => {
      const { repository } = repositoryAnswering([ROW]);

      const [row] = await repository.findPage({ projectId: "proj-1", limit: 10 });

      expect(row).toMatchObject({
        id: "obj-1",
        projectId: "proj-1",
        purpose: "trace_content",
        ownerKind: "span",
        ownerId: "owner-1",
        mediaType: "text/plain",
        sizeBytes: 5,
        sha256: "abc123",
        storageUri: "file:///objects/proj-1/abc123",
      });
      const insertedAfterCreate = row
        ? row.insertedAt.epochMilliseconds - row.createdAt.epochMilliseconds
        : undefined;
      expect(insertedAfterCreate).toBe(DAY_MS);
    });
  });
});
