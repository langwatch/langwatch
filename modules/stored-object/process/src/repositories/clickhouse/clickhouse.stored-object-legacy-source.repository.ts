import { Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import {
  type LegacyStoredObjectRow,
  StoredObjectLegacySourceRepository,
} from "../stored-object-legacy-source.repository.ts";
import { type StoredObjectsClickHouse } from "./stored-objects.repository.ts";

const legacyRowSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  owner_kind: z.string(),
  owner_id: z.string(),
  media_type: z.string(),
  size_bytes: z.coerce.number(),
  sha256: z.string(),
  storage_uri: z.string(),
  created_at: z.string(),
  last_inserted_at: z.string(),
});

/** Pages one project's legacy index by id, each id at its latest version. */
export class ClickHouseStoredObjectLegacySourceRepository extends StoredObjectLegacySourceRepository {
  static create(clickhouse: StoredObjectsClickHouse): ClickHouseStoredObjectLegacySourceRepository {
    return new ClickHouseStoredObjectLegacySourceRepository(clickhouse);
  }

  private constructor(private readonly clickhouse: StoredObjectsClickHouse) {
    super();
  }

  async findPage({
    projectId,
    afterId,
    limit,
  }: {
    projectId: string;
    afterId?: string;
    limit: number;
  }): Promise<readonly LegacyStoredObjectRow[]> {
    const client = await this.clickhouse.resolveClient(projectId);
    const result = await client.query({
      // An alias named after a column shadows it in WHERE and inside argMax (ILLEGAL_AGGREGATION).
      query: `
        SELECT
          id,
          argMax(purpose, inserted_at)     AS purpose,
          argMax(owner_kind, inserted_at)  AS owner_kind,
          argMax(owner_id, inserted_at)    AS owner_id,
          argMax(media_type, inserted_at)  AS media_type,
          argMax(size_bytes, inserted_at)  AS size_bytes,
          argMax(sha256, inserted_at)      AS sha256,
          argMax(storage_uri, inserted_at) AS storage_uri,
          argMax(created_at, inserted_at)  AS created_at,
          max(inserted_at)                 AS last_inserted_at
        FROM stored_objects
        WHERE project_id = {projectId:String}
          AND id > {afterId:String}
        GROUP BY id
        ORDER BY id
        LIMIT {limit:UInt32}
      `,
      query_params: { projectId, afterId: afterId ?? "", limit },
      format: "JSONEachRow",
      // Read-only legacy index under ADR-158: stored_objects has no TenantId column, so the
      // statement is filtered by project_id.
      SKIP_TENANT_CHECK: true,
    });
    const rows = await result.json<unknown>();
    return rows.map((raw) => {
      const row = legacyRowSchema.parse(raw);
      return {
        id: row.id,
        projectId,
        purpose: row.purpose,
        ownerKind: row.owner_kind,
        ownerId: row.owner_id,
        mediaType: row.media_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        storageUri: row.storage_uri,
        createdAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(row.created_at)),
        insertedAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(row.last_inserted_at)),
      };
    });
  }
}
