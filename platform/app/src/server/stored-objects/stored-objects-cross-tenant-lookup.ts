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
import { getApp } from "~/server/app-layer/app";

const tracer = getLangWatchTracer(
  "langwatch.stored-objects.cross-tenant-lookup",
);

/**
 * Thrown when no instance returned a hit AND at least one instance failed.
 *
 * Distinct from "all instances returned empty" (→ null = genuine not_found):
 * here we cannot tell, because some instances couldn't be queried. The route
 * MUST map this to a transient 502, not a 404 — a 404 in this state would
 * make `/api/files/:id` silently return "not found" to a caller whose object
 * actually exists on a temporarily-degraded BYOC instance.
 */
export class StoredObjectOwnerLookupUnavailableError extends Error {
  readonly failedTargets: string[];

  constructor(failedTargets: string[]) {
    super(
      `cross-tenant owner lookup degraded: ${failedTargets.length} instance(s) failed (${failedTargets.join(", ")}); no hit on any healthy instance`,
    );
    this.name = "StoredObjectOwnerLookupUnavailableError";
    this.failedTargets = failedTargets;
  }
}

/**
 * Resolve the owning project for a stored-object id.
 *
 * Cross-tenant — fans out to every configured ClickHouse instance (shared
 * + every private/BYOC instance) and returns the first matching row.
 *
 * Failure isolation (Sergio review 2026-05-20): each instance lookup is
 * isolated with `Promise.allSettled`. If any instance returns a hit, we
 * return that hit even when other instances rejected — a healthy shared
 * lookup must not be globally degraded by one outage in an unrelated BYOC
 * instance. If no hit is found AND at least one instance rejected, we
 * throw `StoredObjectOwnerLookupUnavailableError` rather than returning
 * null, so the caller can return a transient 502 instead of falsely
 * 404'ing an object that may exist on the degraded instance.
 *
 * Stored-object ids are SHA-256 derived from per-tenant salt + content so
 * cross-instance id collisions are not a practical concern; the first
 * match wins.
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
      const repository = getApp().storedObjects.crossTenantOwnerLookup;
      const { hit, failedTargets, instancesSearched } =
        await repository.findOwner(id);

      span.setAttribute("clickhouse.instances_searched", instancesSearched);
      span.setAttribute("clickhouse.instances_failed", failedTargets.length);

      if (hit) {
        span.setAttribute("result.found", true);
        span.setAttribute("result.matched_instance", hit.target);
        return { projectId: hit.projectId };
      }

      if (failedTargets.length > 0) {
        span.setAttribute("result.found", false);
        span.setAttribute("result.degraded", true);
        throw new StoredObjectOwnerLookupUnavailableError(failedTargets);
      }

      span.setAttribute("result.found", false);
      return null;
    },
  );
}
