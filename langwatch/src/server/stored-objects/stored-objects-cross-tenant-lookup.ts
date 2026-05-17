/**
 * Cross-tenant stored-objects lookups.
 *
 * Quarantined from `stored-objects.repository.ts` on purpose: the rest of
 * the repository hits a project-scoped ClickHouse client and filters every
 * query by `project_id`. This module is the documented exception — it
 * uses the *shared* client and intentionally has no project filter,
 * because the caller doesn't yet know which project owns the row.
 *
 * Only the `/api/files/:id` route should reach for these helpers, and
 * only as the very first step of request handling — the moment the
 * owning project is known, every subsequent read MUST switch back to
 * the project-scoped client.
 *
 * Living next to the project-scoped repository inside the same module
 * made it too easy for new code to grab the shared client by reflex.
 * Moving it here makes the unsafe surface impossible to confuse with
 * project-scoped CRUD.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getSharedClickHouseClient } from "~/server/clickhouse/clickhouseClient";

const tracer = getLangWatchTracer(
  "langwatch.stored-objects.cross-tenant-lookup",
);

const TABLE_NAME = "stored_objects";

/**
 * Resolve the owning project for a stored-object id.
 *
 * Cross-tenant — uses the shared ClickHouse client and has no project
 * filter. Returns null when no row matches.
 *
 * The caller is responsible for switching to a project-scoped client
 * before reading anything else about the row.
 */
export async function resolveStoredObjectOwner({
  id,
}: {
  id: string;
}): Promise<{ projectId: string } | null> {
  return tracer.withActiveSpan(
    "StoredObjects.resolveStoredObjectOwner",
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

      const rows = await result.json<{ project_id: string }>();
      span.setAttribute("result.found", rows.length > 0);
      if (rows.length === 0) return null;
      return { projectId: rows[0]!.project_id };
    },
  );
}
