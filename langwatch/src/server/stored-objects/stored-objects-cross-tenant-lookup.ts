/**
 * Cross-tenant stored-objects lookups.
 *
 * Quarantined from `stored-objects.repository.ts` on purpose: the rest of
 * the repository hits a project-scoped ClickHouse client and filters every
 * query by `project_id`. This module is the documented exception — it has
 * no project filter, because the caller doesn't yet know which project
 * owns the row.
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
import { getAllClickHouseInstances } from "~/server/clickhouse/clickhouseClient";

const tracer = getLangWatchTracer(
  "langwatch.stored-objects.cross-tenant-lookup",
);

const TABLE_NAME = "stored_objects";

/**
 * Resolve the owning project for a stored-object id.
 *
 * Cross-tenant — fans out to every configured ClickHouse instance (shared
 * + every private/BYOC instance) and returns the first matching row.
 * Returns null when no row matches in any instance.
 *
 * Pre-fix this only queried the shared client, which made `/api/files/:id`
 * return 404 for any object owned by a tenant routed to a private CH
 * instance (Sergio review 2026-05-20). Stored-object ids are SHA-256
 * derived from per-tenant salt + content so cross-instance id collisions
 * are not a practical concern; the first match wins.
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
      const instances = await getAllClickHouseInstances();
      if (instances.length === 0) {
        throw new Error(
          "ClickHouse is not configured — cannot resolve owner project for stored object",
        );
      }
      span.setAttribute("clickhouse.instances_searched", instances.length);

      const lookups = instances.map(async ({ client, target }) => {
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
        return rows.length > 0
          ? { projectId: rows[0]!.project_id, target }
          : null;
      });

      const results = await Promise.all(lookups);
      const hit = results.find((r): r is NonNullable<typeof r> => r !== null);
      if (!hit) {
        span.setAttribute("result.found", false);
        return null;
      }

      span.setAttribute("result.found", true);
      span.setAttribute("result.matched_instance", hit.target);
      return { projectId: hit.projectId };
    },
  );
}
