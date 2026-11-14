import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import {
  type LegacyStoredObjectRow,
  StoredObjectLegacySourceRepository,
} from "../stored-object-legacy-source.repository.ts";
import { storedObjectsTable as t } from "./clickhouse.stored-objects.table.ts";
import { type StoredObjectsClickHouse } from "./stored-objects.repository.ts";

const legacyRowSchema = z.object({
  id: z.string(),
  latest_purpose: z.string(),
  latest_owner_kind: z.string(),
  latest_owner_id: z.string(),
  latest_media_type: z.string(),
  latest_size_bytes: z.coerce.number(),
  latest_sha256: z.string(),
  latest_storage_uri: z.string(),
  latest_created_at: z.string(),
  last_inserted_at: z.string(),
});

/** One project's legacy index, a page of ids each at its latest version, as a built statement. */
function legacyStoredObjectPageStatement({
  projectId,
  afterId,
  limit,
}: {
  projectId: string;
  afterId: string;
  limit: number;
}) {
  // No alias takes a column's name: one would shadow it in WHERE and inside argMax.
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select({
      id: t.id,
      latest_purpose: fn.argMax(t.purpose, t.inserted_at),
      latest_owner_kind: fn.argMax(t.owner_kind, t.inserted_at),
      latest_owner_id: fn.argMax(t.owner_id, t.inserted_at),
      latest_media_type: fn.argMax(t.media_type, t.inserted_at),
      latest_size_bytes: fn.argMax(t.size_bytes, t.inserted_at),
      latest_sha256: fn.argMax(t.sha256, t.inserted_at),
      latest_storage_uri: fn.argMax(t.storage_uri, t.inserted_at),
      latest_created_at: fn.argMax(t.created_at, t.inserted_at),
      last_inserted_at: fn.max(t.inserted_at),
    })
    .where(({ gt }) => gt(t.id, afterId))
    .groupBy(t.id)
    .orderBy(t.id)
    .limit(limit)
    .build();
}

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
    const client: Pick<ClickHouseQueryClient, "read"> =
      await this.clickhouse.resolveClient(projectId);
    const { rows } = await client.read({
      statement: legacyStoredObjectPageStatement({ projectId, afterId: afterId ?? "", limit }),
      table: "stored_objects",
      // The import copies a project's whole legacy index, so every created_at partition is read.
      declaresFullScan: true,
    });
    return rows.map((raw) => {
      const row = legacyRowSchema.parse(raw);
      return {
        id: row.id,
        projectId,
        purpose: row.latest_purpose,
        ownerKind: row.latest_owner_kind,
        ownerId: row.latest_owner_id,
        mediaType: row.latest_media_type,
        sizeBytes: row.latest_size_bytes,
        sha256: row.latest_sha256,
        storageUri: row.latest_storage_uri,
        createdAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(row.latest_created_at)),
        insertedAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(row.last_inserted_at)),
      };
    });
  }
}
