/**
 * StoredObjectsRepository — ClickHouse I/O for the stored_objects table.
 *
 * All queries scope to project_id first (tenant isolation) per
 * dev/docs/best_practices/clickhouse-queries.md.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  getClickHouseClientForProject,
  getSharedClickHouseClient,
} from "~/server/clickhouse/clickhouseClient";
import type { StoredObject } from "./stored-object";
import { storedObjectSchema } from "./stored-object";

const TABLE_NAME = "stored_objects" as const;

const tracer = getLangWatchTracer("langwatch.stored-objects.repository");

/**
 * ClickHouse repository for stored_objects rows.
 *
 * Clients are resolved at call time via `getClickHouseClientForProject` so
 * per-tenant private ClickHouse routing is always respected.
 */
export class StoredObjectsRepository {
  /**
   * Inserts a single stored_objects row.
   *
   * Wrapped in a CLIENT span so ClickHouse latency is visible in traces.
   */
  async insert({
    projectId,
    row,
  }: {
    projectId: string;
    row: StoredObject;
  }): Promise<void> {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.insert",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "INSERT",
          "tenant.id": projectId,
          "stored_object.id": row.id,
          "stored_object.purpose": row.purpose,
        },
      },
      async () => {
        const client = await getClickHouseClientForProject(projectId);

        await client.insert({
          table: TABLE_NAME,
          values: [
            {
              id: row.id,
              project_id: row.project_id,
              purpose: row.purpose,
              owner_kind: row.owner_kind,
              owner_id: row.owner_id,
              media_type: row.media_type,
              size_bytes: row.size_bytes,
              sha256: row.sha256,
              storage_uri: row.storage_uri,
              created_at: row.created_at,
              inserted_at: row.inserted_at,
            },
          ],
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
        });
      },
    );
  }

  /**
   * Returns the stored_objects row with the given id, or null if not found.
   *
   * Uses the scalar-subquery single-row dedup pattern recommended by
   * dev/docs/best_practices/clickhouse-queries.md for ReplacingMergeTree.
   * The table's version column is `inserted_at`.
   */
  async findById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<StoredObject | null> {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.findById",
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
        const client = await getClickHouseClientForProject(projectId);

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
          created_at: new Date(raw.created_at as string),
          inserted_at: new Date(raw.inserted_at as string),
        });
      },
    );
  }

  /**
   * Returns the id of an existing stored_objects row whose sha256 matches,
   * or null if no such row exists for this project.
   *
   * Used by storeFromBytes to implement content-addressed deduplication.
   */
  async findBySha256({
    projectId,
    sha256,
  }: {
    projectId: string;
    sha256: string;
  }): Promise<{ id: string } | null> {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.findBySha256",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "tenant.id": projectId,
          "stored_object.sha256": sha256,
        },
      },
      async (span) => {
        const client = await getClickHouseClientForProject(projectId);

        const result = await client.query({
          query: `
            SELECT id
            FROM ${TABLE_NAME}
            WHERE project_id = {projectId:String}
              AND sha256 = {sha256:String}
            LIMIT 1
          `,
          query_params: { projectId, sha256 },
          format: "JSONEachRow",
        });

        const rows = await result.json<{ id: string }[]>();

        span.setAttribute("result.found", rows.length > 0);

        if (rows.length === 0) {
          return null;
        }

        return { id: rows[0]!.id };
      },
    );
  }

  /**
   * Resolves the owning project for a stored_object id.
   *
   * Exception to the tenant-filter rule: callers (e.g. GET /api/files/:id)
   * don't yet know which project owns a file when they only have the object id.
   * This method performs a cross-tenant lookup on the shared ClickHouse client
   * to recover the project_id. Once the project is resolved, all subsequent
   * reads MUST be project-scoped.
   *
   * Returns null when no row matches the given id.
   */
  async findProjectByObjectId({
    id,
  }: {
    id: string;
  }): Promise<{ projectId: string } | null> {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.findProjectByObjectId",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "stored_object.id": id,
        },
      },
      async (span) => {
        const client = getSharedClickHouseClient();

        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot resolve owner project for stored object",
          );
        }

        const result = await client.query({
          query: `
            SELECT project_id
            FROM ${TABLE_NAME}
            WHERE id = {id:String}
            LIMIT 1
          `,
          query_params: { id },
          format: "JSONEachRow",
        });

        const rows = await result.json<{ project_id: string }[]>();

        span.setAttribute("result.found", rows.length > 0);

        if (rows.length === 0) {
          return null;
        }

        return { projectId: rows[0]!.project_id };
      },
    );
  }
}
