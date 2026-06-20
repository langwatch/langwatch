/**
 * StoredObjectsRepository — ClickHouse I/O for the stored_objects table.
 *
 * All queries scope to project_id first (tenant isolation) per
 * dev/docs/best_practices/clickhouse-queries.md.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
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
        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot insert stored object",
          );
        }

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
          // wait_for_async_insert=1: surface insert errors synchronously to
          // the caller. Without this, async_insert acknowledges immediately
          // and a later batching/network failure is dropped silently — the
          // service would then return success while no row was written. We
          // already pay for a storage PUT before the insert, so making the
          // insert synchronous is the only way the compensating-cleanup
          // path (delete bytes if insert fails) can fire reliably.
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
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
        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot find stored object by id",
          );
        }

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
        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot find stored object by sha256",
          );
        }

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

        const rows = await result.json<{ id: string }>();

        span.setAttribute("result.found", rows.length > 0);

        if (rows.length === 0) {
          return null;
        }

        return { id: rows[0]!.id };
      },
    );
  }

  /**
   * Streams (id, storage_uri) pairs for every live row owned by the project.
   *
   * Used by `deleteOwnedBy` to enumerate the bytes that need to be
   * deleted from the storage backend before the rows themselves are removed.
   * Uses the scalar-subquery dedup pattern so ReplacingMergeTree-soft-deleted
   * tombstones are filtered out before the cascade tries to delete bytes that
   * may already be gone.
   */
  async findAllByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<Array<{ id: string; storage_uri: string }>> {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.findAllByProject",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "tenant.id": projectId,
        },
      },
      async (span) => {
        const client = await getClickHouseClientForProject(projectId);
        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot enumerate stored objects",
          );
        }

        // Project-scoped enumeration. Two notes on cost:
        //
        //   1. Dedup uses the IN-tuple pattern, not a correlated scalar
        //      subquery — the inner GROUP BY runs once and produces the
        //      (id, max(inserted_at)) set, then the outer matches against
        //      it. The previous correlated form (`inserted_at = (SELECT
        //      max(s.inserted_at) WHERE s.id = t.id)`) re-ran the inner
        //      query for every row.
        //   2. No `created_at` (partition) predicate is possible here —
        //      cascade-delete needs every row that has ever existed for
        //      this project, including very old objects sitting in cold
        //      S3 partitions. The scan is bounded by `project_id IN
        //      ORDER BY` so it walks only that project's granules within
        //      each partition, but the partition fan-out itself is
        //      unavoidable. Run sparingly; this is a project-deletion
        //      cascade, not a hot path.
        const result = await client.query({
          query: `
            SELECT
              t.id          AS id,
              t.storage_uri AS storage_uri
            FROM ${TABLE_NAME} AS t
            WHERE t.project_id = {projectId:String}
              AND (t.project_id, t.id, t.inserted_at) IN (
                SELECT project_id, id, max(inserted_at)
                FROM ${TABLE_NAME}
                WHERE project_id = {projectId:String}
                GROUP BY project_id, id
              )
          `,
          query_params: { projectId },
          format: "JSONEachRow",
        });

        const rows = await result.json<{ id: string; storage_uri: string }>();
        span.setAttribute("result.count", rows.length);
        return rows;
      },
    );
  }

  /**
   * Deletes every stored_objects row for a project (and optionally a single
   * owner) via ClickHouse ALTER TABLE DELETE.
   *
   * ALTER TABLE DELETE is an async mutation in ClickHouse — the SELECT-side
   * effect is immediate (rows disappear from query results once the mutation
   * is queued), but the actual disk reclamation runs in the background.
   * Callers do NOT need to wait for the mutation to finalize; the rows are
   * not observable through `findById` / `findAllByProject` after this call.
   *
   * This is irreversible at the data-plane level: callers MUST have already
   * deleted the underlying bytes from the storage backend before invoking
   * this method, otherwise the byte content orphans in S3/disk with no row
   * pointing at it.
   */
  async deleteByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<void> {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.deleteByProject",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "DELETE",
          "tenant.id": projectId,
        },
      },
      async () => {
        const client = await getClickHouseClientForProject(projectId);
        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot delete stored objects",
          );
        }

        await client.exec({
          query: `
            ALTER TABLE ${TABLE_NAME}
            DELETE WHERE project_id = {projectId:String}
          `,
          query_params: { projectId },
          clickhouse_settings: {
            // Wait until the mutation is at least submitted before we
            // consider the call done; we do NOT wait for finalization
            // (that can take minutes on big partitions). The follow-up
            // SELECT in tests uses FINAL or polls for the SELECT-side
            // visibility flip.
            mutations_sync: "1",
          },
        });
      },
    );
  }

  /**
   * Deletes a specific subset of stored-objects rows by id within a project.
   *
   * Used by `deleteOwnedBy` to remove ONLY the rows whose underlying byte
   * deletes succeeded. Rows whose byte-delete failed are intentionally left
   * behind as retryable tombstones — the operator can re-run the cascade,
   * and the lingering rows still point at the leaked `storage_uri` so the
   * GC sweep knows what to chase. Dropping those rows along with the
   * succeeded ones would lose the address of the orphaned bytes
   * irrecoverably (Sergio review 2026-05-20).
   *
   * Same caveats as `deleteByProject`: callers MUST have already deleted
   * the underlying bytes for the ids passed here.
   */
  async deleteByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<void> {
    if (ids.length === 0) return;
    return tracer.withActiveSpan(
      "StoredObjectsRepository.deleteByIds",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "DELETE",
          "tenant.id": projectId,
          "stored_objects.ids_count": ids.length,
        },
      },
      async () => {
        const client = await getClickHouseClientForProject(projectId);
        if (!client) {
          throw new Error(
            "ClickHouse is not configured — cannot delete stored objects",
          );
        }
        await client.exec({
          query: `
            ALTER TABLE ${TABLE_NAME}
            DELETE WHERE project_id = {projectId:String}
              AND id IN ({ids:Array(String)})
          `,
          query_params: { projectId, ids },
          clickhouse_settings: { mutations_sync: "1" },
        });
      },
    );
  }
}
