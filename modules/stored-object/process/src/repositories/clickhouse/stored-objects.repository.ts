import { Temporal, toDate, toEpochMs } from "@langwatch/time";
/**
 * StoredObjectsRepository — ClickHouse I/O for the stored_objects table.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { StoredObjectsClickHouse } from "../../app/stored-object.members.ts";
import type { StoredObject } from "../../rules/stored-object-row.rules.ts";
import { storedObjectSchema } from "../../rules/stored-object-row.rules.ts";
import { StoredObjectsRepository } from "../stored-objects.repository.ts";

const TABLE_NAME = "stored_objects" as const;

/**
 * The table is the read-only legacy index (ADR-158) and has no TenantId column: every
 * statement here is scoped by project_id, which the tenant guard's text check cannot see.
 */
const LEGACY_INDEX_UNSCOPED = {
  reason:
    "Read-only legacy index under ADR-158: stored_objects has no TenantId column, so the statement is filtered by project_id.",
} as const;

const tracer = getLangWatchTracer("langwatch.stored-objects.repository");

/**
 * ClickHouse repository for stored_objects rows.
 */
export class ClickHouseStoredObjectsRepository extends StoredObjectsRepository {
  static create(clickhouse: StoredObjectsClickHouse): ClickHouseStoredObjectsRepository {
    return new ClickHouseStoredObjectsRepository(clickhouse);
  }

  /**
   * The routed connection rather than a client, and per call rather than once:
   * a private-route tenant's rows live on its own cluster, so which client
   * answers is a function of the project the read names.
   */
  private constructor(private readonly clickhouse: StoredObjectsClickHouse) {
    super();
  }

  /**
   * Returns the stored_objects row with the given id, or null if not found. An arrow instance
   * property to match the base class's property-typed declaration.
   */
  tryFindById = async ({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<StoredObject | null> => {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.tryFindById",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "tenant.id": projectId,
          "stored_object.id": id,
        },
      },
      async (span) => {
        const client = await this.clickhouse.resolveClient(projectId);

        // Scalar-subquery dedup: inner reads only (project_id, id, inserted_at)
        // to find max(inserted_at), outer reads the full row for that version.
        const result = await client.query({
          query: `
            SELECT
              t.id           AS id,
              t.project_id   AS project_id,
              t.purpose      AS purpose,
              t.owner_kind   AS owner_kind,
              t.owner_id     AS owner_id,
              t.media_type   AS media_type,
              t.size_bytes   AS size_bytes,
              t.sha256       AS sha256,
              t.storage_uri  AS storage_uri,
              t.created_at   AS created_at,
              t.inserted_at  AS inserted_at
            FROM ${TABLE_NAME} AS t
            WHERE t.project_id = {projectId:String}
              AND t.id = {id:String}
              AND t.inserted_at = (
                SELECT max(s.inserted_at)
                FROM ${TABLE_NAME} AS s
                WHERE s.project_id = {projectId:String}
                  AND s.id = {id:String}
              )
            LIMIT 1
          `,
          query_params: { projectId, id },
          format: "JSONEachRow",
          unscoped: LEGACY_INDEX_UNSCOPED,
        });

        const rows = await result.json<Record<string, unknown>>();

        span.setAttribute("result.found", rows.length > 0);

        if (rows.length === 0) {
          return null;
        }

        const raw = rows[0]!;
        return storedObjectSchema.parse({
          id: raw.id,
          project_id: raw.project_id,
          purpose: raw.purpose,
          owner_kind: raw.owner_kind,
          owner_id: raw.owner_id,
          media_type: raw.media_type,
          size_bytes: Number(raw.size_bytes),
          sha256: raw.sha256,
          storage_uri: raw.storage_uri,
          created_at: clickHouseDate(raw.created_at),
          inserted_at: clickHouseDate(raw.inserted_at),
        });
      },
    );
  };
}

/**
 * ClickHouse hands a DateTime64 back as an ISO string; the row schema declares
 * a `Date` because the client serialises one on the way back in.
 */
function clickHouseDate(value: unknown): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value as string)));
}
