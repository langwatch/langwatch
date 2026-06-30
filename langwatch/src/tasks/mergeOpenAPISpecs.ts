import deepmerge from "deepmerge";

/**
 * A minimal structural type for an OpenAPI spec document. We only care about
 * the `paths` object here; everything else is passed through untouched.
 */
export type OpenAPISpec = {
  paths?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Array merge strategy: replace the destination array with the source array
 * instead of concatenating. OpenAPI arrays (e.g. parameter lists, enum values)
 * are authoritative from the generating app, not additive.
 */
const overwriteMerge = (_destinationArray: unknown[], sourceArray: unknown[]) =>
  sourceArray;

/**
 * Returns the 2-segment `/api/<namespace>` prefix that owns a given path.
 *
 * Each Hono app owns its entire `/api/<namespace>` and is the single source of
 * truth for it, so ownership is keyed on the first two path segments only.
 *
 * Examples:
 *   "/api/prompts/{id}/versions" -> "/api/prompts"
 *   "/api/gateway/v1/budgets"    -> "/api/gateway"
 *   "/api/model-defaults"        -> "/api/model-defaults"
 *   "/"                          -> "/"
 */
function apiNamespace(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "/";
  }
  return "/" + segments.slice(0, 2).join("/");
}

/**
 * Merges freshly-generated per-app OpenAPI specs onto the committed spec.
 *
 * Each merged Hono app owns its `/api/<namespace>` entirely, so those
 * namespaces are 1:1 with the fresh app specs: the set of owned namespaces is
 * DERIVED from the fresh specs this run (never a hand-maintained list, so it
 * cannot drift). Every committed path in an owned namespace is dropped before
 * merging, then repopulated from the app specs — so routes that an app no
 * longer generates (removed routes, renamed path params) are pruned instead of
 * lingering forever, and routes that still exist are refreshed via a clean
 * replace (no stale sub-keys survive, because there is no collision left to
 * deep-merge).
 *
 * Paths in namespaces that NO app generates are hand-maintained (e.g.
 * `/api/annotations`, `/api/projects`, the singular `/api/trace`, the root
 * `/`) and are always preserved untouched.
 *
 * Ownership is keyed on what the apps EMIT this run, so the prune targets
 * removed/renamed routes within a namespace an app still serves. A namespace an
 * app stops emitting entirely (e.g. an app dropped from the generator) has no
 * fresh path to key on, so its committed paths are treated as hand-maintained
 * and preserved — fully retiring a namespace stays a deliberate manual step.
 * Deriving ownership from output (not a hand-maintained prefix list) is the
 * deliberate trade-off: adding an app needs zero wiring, and a transient
 * generation failure can never silently wipe a live namespace.
 *
 * Scope: only `paths` are pruned. Shared top-level buckets such as
 * `components.schemas` are deep-merged across apps (a later app wins a name
 * clash), so a renamed or removed schema can still linger there — a separate
 * orphan class from path orphans, left as a follow-up.
 */
export function mergeOpenAPISpecs({
  currentSpec,
  appSpecs,
  baseSpec,
}: {
  currentSpec: OpenAPISpec;
  appSpecs: OpenAPISpec[];
  baseSpec: OpenAPISpec;
}): OpenAPISpec {
  const freshPaths = new Set<string>();
  for (const spec of appSpecs) {
    for (const path of Object.keys(spec.paths ?? {})) {
      freshPaths.add(path);
    }
  }

  const ownedNamespaces = new Set<string>();
  for (const path of freshPaths) {
    ownedNamespaces.add(apiNamespace(path));
  }

  const strippedPaths: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(currentSpec.paths ?? {})) {
    if (!ownedNamespaces.has(apiNamespace(path))) {
      strippedPaths[path] = value;
    }
  }

  return deepmerge.all<OpenAPISpec>(
    [{ ...currentSpec, paths: strippedPaths }, ...appSpecs, baseSpec],
    { arrayMerge: overwriteMerge },
  );
}
