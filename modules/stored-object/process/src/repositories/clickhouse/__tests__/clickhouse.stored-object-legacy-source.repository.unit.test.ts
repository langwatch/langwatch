/**
 * The legacy index page query: no alias shadows a column it filters or aggregates by, which
 * ClickHouse refuses with ILLEGAL_AGGREGATION and parks the import (WEB-9100).
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseStoredObjectLegacySourceRepository } from "../clickhouse.stored-object-legacy-source.repository.ts";
import type { StoredObjectsClickHouse } from "../stored-objects.repository.ts";

const DAY_MS = 86_400_000;

const ROW = {
  id: "obj-1",
  purpose: "trace_content",
  owner_kind: "span",
  owner_id: "owner-1",
  media_type: "text/plain",
  size_bytes: "5",
  sha256: "abc123",
  storage_uri: "file:///objects/proj-1/abc123",
  created_at: "2025-01-01 00:00:00.000",
  last_inserted_at: "2025-01-02 00:00:00.000",
};

function repositoryAnswering(rows: unknown[]) {
  const query = vi.fn(async (_request: { query: string }) => ({
    json: async () => JSON.parse(JSON.stringify(rows)),
  }));
  class FakeStoredObjectsClickHouse implements StoredObjectsClickHouse {
    async resolveClient() {
      return { query };
    }
  }
  const repository = ClickHouseStoredObjectLegacySourceRepository.create(
    new FakeStoredObjectsClickHouse(),
  );
  return { query, repository };
}

describe("given a project's legacy stored-object index", () => {
  describe("when the import pages it", () => {
    it("never aliases an aggregate as the project or insert column", async () => {
      const { query, repository } = repositoryAnswering([]);

      await repository.findPage({ projectId: "proj-1", limit: 10 });

      expect(query.mock.calls[0]?.[0].query).not.toMatch(/AS\s+(project_id|inserted_at)\b/);
    });

    it("maps each row to the paged project and its latest insert", async () => {
      const { repository } = repositoryAnswering([ROW]);

      const [row] = await repository.findPage({ projectId: "proj-1", limit: 10 });

      expect(row).toMatchObject({ id: "obj-1", projectId: "proj-1", sizeBytes: 5 });
      const insertedAfterCreate = row
        ? row.insertedAt.epochMilliseconds - row.createdAt.epochMilliseconds
        : undefined;
      expect(insertedAfterCreate).toBe(DAY_MS);
    });
  });
});
