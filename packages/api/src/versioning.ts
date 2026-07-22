import type {
  EndpointRegistration,
  HttpMethod,
  VersionStatus,
} from "./types.js";
import { isDateVersion, VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

export { VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

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
  | {
      method: HttpMethod | "sse";
      path: string;
      config: EndpointRegistration["config"];
      withdrawn: true;
    };

/** A composite key for de-duplicating endpoints within a version. */
function endpointKey({
  method,
  path,
}: {
  method: string;
  path: string;
}): string {
  const normalized = method === "sse" ? "get" : method;
  const normalizedPath = path === "" ? "/" : path;
  return `${normalized}:${normalizedPath}`;
}

function applyRegistrations({
  target,
  endpoints,
}: {
  target: Map<string, ResolvedEndpoint>;
  endpoints: EndpointRegistration[];
}): void {
  for (const ep of endpoints) {
    const key = endpointKey({ method: ep.method, path: ep.path });
    if (ep.withdrawn) {
      const inherited = target.get(key);
      target.set(key, {
        method: ep.method,
        path: ep.path,
        config: inherited?.config ?? ep.config,
        withdrawn: true,
      });
    } else {
      target.set(key, { ...ep, withdrawn: false });
    }
  }
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
export function resolveVersions({
  definitions,
  previewEndpoints,
}: {
  definitions: VersionDefinition[];
  previewEndpoints: EndpointRegistration[];
}): Map<string, ResolvedEndpoint[]> {
  const seenVersions = new Set<string>();
  for (const definition of definitions) {
    if (!isDateVersion(definition.version)) {
      throw new RangeError(
        `Invalid API version "${definition.version}"; expected a real date in YYYY-MM-DD form`,
      );
    }
    if (seenVersions.has(definition.version)) {
      throw new Error(
        `API version "${definition.version}" is registered more than once`,
      );
    }
    seenVersions.add(definition.version);
  }

  const dated = [...definitions].sort((a, b) =>
    a.version.localeCompare(b.version),
  );

  const result = new Map<string, ResolvedEndpoint[]>();
  let previousMap = new Map<string, ResolvedEndpoint>();

  for (const def of dated) {
    // Start with a copy of the previous version
    const currentMap = new Map(previousMap);
    applyRegistrations({ target: currentMap, endpoints: def.endpoints });

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
    const previewMap = new Map<string, ResolvedEndpoint>();
    applyRegistrations({ target: previewMap, endpoints: previewEndpoints });
    result.set(VERSION_PREVIEW, Array.from(previewMap.values()));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Request-time version resolution
// ---------------------------------------------------------------------------

export type ResolvedVersion =
  | {
      found: true;
      version: string;
      status: VersionStatus;
      endpoints: ResolvedEndpoint[];
    }
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
export function resolveRequestVersion({
  versionMap,
  requestVersion,
}: {
  versionMap: Map<string, ResolvedEndpoint[]>;
  requestVersion: string | undefined;
}): ResolvedVersion {
  if (requestVersion === undefined) {
    // Bare path -- alias for latest
    const latest = versionMap.get(VERSION_LATEST);
    if (!latest) return { found: false };
    return {
      found: true,
      version: VERSION_LATEST,
      status: "unversioned",
      endpoints: latest,
    };
  }

  if (requestVersion === VERSION_LATEST) {
    const latest = versionMap.get(VERSION_LATEST);
    if (!latest) return { found: false };
    return {
      found: true,
      version: VERSION_LATEST,
      status: "latest",
      endpoints: latest,
    };
  }

  if (requestVersion === VERSION_PREVIEW) {
    const preview = versionMap.get(VERSION_PREVIEW);
    if (!preview) return { found: false };
    return {
      found: true,
      version: VERSION_PREVIEW,
      status: "preview",
      endpoints: preview,
    };
  }

  if (isDateVersion(requestVersion)) {
    const endpoints = versionMap.get(requestVersion);
    if (!endpoints) return { found: false };
    return {
      found: true,
      version: requestVersion,
      status: "stable",
      endpoints,
    };
  }

  return { found: false };
}
