/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the bloom_filter skip-index on stored_objects.id (migration 00033):
 *  - the migration actually attaches idx_id to the table, and
 *  - the cross-tenant lookup shape (`WHERE id = {id}`, no project_id) still
 *    returns the correct row.
 *
 * The lookup is by `id` alone — the second ORDER BY column — so without a skip
 * index it falls back to a full scan. The index lets ClickHouse skip granule
 * blocks that cannot contain the id; correctness is identical either way, which
 * is what this test pins.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestContainers, stopTestContainers } from "../../event-sourcing/__tests__/integration/testContainers";

let ch: ClickHouseClient;
const tag = nanoid();

async function insertObject(projectId: string, id: string) {
  await ch.command({
    query: `
      INSERT INTO stored_objects
        (id, project_id, purpose, owner_kind, owner_id, media_type, size_bytes, sha256, storage_uri, created_at, inserted_at)
      VALUES
        ({id:String}, {projectId:String}, 'input', 'trace', {id:String}, 'application/json', 10, {id:String}, 's3://b/k', now64(3), now64(3))
    `,
    query_params: { id, projectId },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE stored_objects DELETE WHERE startsWith(id, {tag:String})`,
      query_params: { tag },
    });
  }
  await stopTestContainers();
});

describe("stored_objects id skip-index (migration 00033)", () => {
  it("attaches a bloom_filter index on id", async () => {
    const ddl = await (
      await ch.query({ query: "SHOW CREATE TABLE stored_objects", format: "TabSeparatedRaw" })
    ).text();
    expect(ddl).toMatch(/INDEX\s+idx_id\s+id\s+TYPE\s+bloom_filter/i);
  });

  describe("when looking up an object by id alone (cross-tenant)", () => {
    it("returns the owning project_id", async () => {
      const id = `${tag}-obj-a`;
      const projectId = `${tag}-project-a`;
      await insertObject(projectId, id);
      await insertObject(`${tag}-project-b`, `${tag}-obj-b`);

      const rows = await (
        await ch.query({
          query: "SELECT project_id FROM stored_objects WHERE id = {id:String} LIMIT 1",
          query_params: { id },
          format: "JSONEachRow",
        })
      ).json<{ project_id: string }>();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.project_id).toBe(projectId);
    });

    it("returns nothing for an id that does not exist", async () => {
      const rows = await (
        await ch.query({
          query: "SELECT project_id FROM stored_objects WHERE id = {id:String} LIMIT 1",
          query_params: { id: `${tag}-missing` },
          format: "JSONEachRow",
        })
      ).json<{ project_id: string }>();

      expect(rows).toHaveLength(0);
    });
  });
});
