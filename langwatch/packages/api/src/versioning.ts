import type { EndpointRegistration, HttpMethod } from "./types.js";
import { isDateVersion, VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

// ---------------------------------------------------------------------------
// Version registration input (collected by the builder)
// ---------------------------------------------------------------------------

export interface VersionDefinition {
  /** The dated version label, e.g. `"2025-03-15"`. */
  version: string;
  /** Endpoints registered in this version (including withdrawals). */
  endpoints: EndpointRegistration[];
}

// ---------------------------------------------------------------------------
// Resolved endpoint map (after forward-copying)
// ---------------------------------------------------------------------------

/**
 * A fully resolved endpoint: either active (has a handler) or withdrawn
 * (returns 410 Gone).
 */
export type ResolvedEndpoint =
  | (EndpointRegistration & { withdrawn?: false })
  | { method: HttpMethod | "sse"; path: string; withdrawn: true };

/** A composite key for de-duplicating endpoints within a version. */
function endpointKey(method: string, path: string): string {
  const normalized = method === "sse" ? "get" : method;
  return `${normalized}:${path}`;
}

// ---------------------------------------------------------------------------
// Forward-copy algorithm
// ---------------------------------------------------------------------------

/**
 * Resolves all version definitions into concrete endpoint maps per version.
 *
 * Algorithm:
 * 1. Sort dated versions chronologically.
 * 2. For each version, start with a **copy** of the previous version's map.
 * 3. Apply the current version's registrations (overrides / additions).
 * 4. Withdrawn endpoints are kept as `{ withdrawn: true }` markers.
 * 5. The final dated version is aliased as `latest`.
 * 6. `preview` endpoints are separate and never included in `latest`.
 *
 * @returns A map from version label to its resolved endpoint array.
 */
export function resolveVersions(
  definitions: VersionDefinition[],
  previewEndpoints: EndpointRegistration[],
): Map<string, ResolvedEndpoint[]> {
  const dated = definitions
    .filter((d) => isDateVersion(d.version))
    .sort((a, b) => a.version.localeCompare(b.version));

  const result = new Map<string, ResolvedEndpoint[]>();
  let previousMap = new Map<string, ResolvedEndpoint>();

  for (const def of dated) {
    // Start with a copy of the previous version
    const currentMap = new Map(previousMap);

    for (const ep of def.endpoints) {
      const key = endpointKey(ep.method, ep.path);

      if (ep.withdrawn) {
        currentMap.set(key, { method: ep.method, path: ep.path, withdrawn: true });
      } else {
        currentMap.set(key, { ...ep, withdrawn: false });
      }
    }

    result.set(def.version, Array.from(currentMap.values()));
    previousMap = currentMap;
  }

  // `latest` = final dated version
  if (dated.length > 0) {
    const latestVersion = dated[dated.length - 1]!.version;
    const latestEndpoints = result.get(latestVersion)!;
    result.set(VERSION_LATEST, latestEndpoints);
  }

  // `preview` endpoints are separate
  if (previewEndpoints.length > 0) {
    result.set(
      VERSION_PREVIEW,
      previewEndpoints.map((ep) => ({ ...ep, withdrawn: false as const })),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Request-time version resolution
// ---------------------------------------------------------------------------

export type ResolvedVersion =
  | { found: true; version: string; status: "stable" | "latest" | "preview" | "unversioned"; endpoints: ResolvedEndpoint[] }
  | { found: false };

/**
 * Resolves a version string from the request path to a set of endpoints.
 *
 * - Exact dated version match (e.g. `"2025-03-15"`) -- status `"stable"`.
 * - `"latest"` -- resolves to newest dated version, status `"latest"`.
 * - `"preview"` -- resolves to preview endpoints, status `"preview"`.
 * - `undefined` (bare path, no version segment) -- resolves to latest, status `"unversioned"`.
 * - Anything else -- `{ found: false }`.
 */
export function resolveRequestVersion(
  versionMap: Map<string, ResolvedEndpoint[]>,
  requestVersion: string | undefined,
): ResolvedVersion {
  if (requestVersion === undefined) {
    // Bare path -- alias for latest
    const latest = versionMap.get(VERSION_LATEST);
    if (!latest) return { found: false };
    return { found: true, version: VERSION_LATEST, status: "unversioned", endpoints: latest };
  }

  if (requestVersion === VERSION_LATEST) {
    const latest = versionMap.get(VERSION_LATEST);
    if (!latest) return { found: false };
    return { found: true, version: VERSION_LATEST, status: "latest", endpoints: latest };
  }

  if (requestVersion === VERSION_PREVIEW) {
    const preview = versionMap.get(VERSION_PREVIEW);
    if (!preview) return { found: false };
    return { found: true, version: VERSION_PREVIEW, status: "preview", endpoints: preview };
  }

  if (isDateVersion(requestVersion)) {
    const endpoints = versionMap.get(requestVersion);
    if (!endpoints) return { found: false };
    return { found: true, version: requestVersion, status: "stable", endpoints };
  }

  return { found: false };
}
