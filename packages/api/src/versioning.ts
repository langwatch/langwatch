import type { EndpointRegistration, HttpMethod } from "./types.js";
import { isDateVersion, VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

export { VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

// ---------------------------------------------------------------------------
// Registration events (collected by the builder)
// ---------------------------------------------------------------------------

/**
 * One `register*` / `withdraw` call, in call order. The version catalogue is
 * the union of versions named across these events (ADR 001 §7).
 */
export interface RegistrationEvent {
  /** The dated version label, e.g. `"2025-03-15"`, or `"preview"`. */
  version: string;
  /** The registration; withdrawals carry `withdrawn: true`. */
  endpoint: EndpointRegistration;
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

function applyEvents({
  target,
  events,
}: {
  target: Map<string, ResolvedEndpoint>;
  events: RegistrationEvent[];
}): void {
  for (const { endpoint: ep } of events) {
    if (ep.withdrawn) {
      // A withdrawal names the endpoint, not the method: mark every inherited
      // registration at that path, keeping its config on the mount report. An
      // endpoint that was never registered has nothing to withdraw — it stays
      // a plain 404.
      for (const [key, inherited] of target) {
        if ((inherited.path || "/") !== (ep.path || "/")) continue;
        target.set(key, {
          method: inherited.method,
          path: inherited.path,
          config: inherited.config,
          withdrawn: true,
        });
      }
    } else {
      target.set(endpointKey(ep), { ...ep, withdrawn: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Forward-copy algorithm
// ---------------------------------------------------------------------------

/**
 * Resolves registration events into concrete endpoint maps per version.
 *
 * Algorithm:
 * 1. Collect the distinct dated versions and sort them chronologically.
 * 2. For each version, start with a **copy** of the previous version's map.
 * 3. Apply the version's events in call order (overrides / additions /
 *    withdrawals).
 * 4. Withdrawn endpoints are kept as `{ withdrawn: true }` markers.
 * 5. The final dated version is aliased as `latest`.
 * 6. `preview` events resolve into a separate namespace that is never part of
 *    `latest`.
 *
 * Inheritance falls out of the data: an endpoint serves at version V its latest
 * registration dated on or before V.
 *
 * @returns A map from version label to its resolved endpoint array.
 */
export function resolveVersions(
  events: RegistrationEvent[],
): Map<string, ResolvedEndpoint[]> {
  const datedVersions = [
    ...new Set(events.map((event) => event.version)),
  ].filter((version) => version !== VERSION_PREVIEW);

  for (const version of datedVersions) {
    if (!isDateVersion(version)) {
      throw new RangeError(
        `Invalid API version "${version}"; expected a real date in YYYY-MM-DD form`,
      );
    }
  }
  datedVersions.sort((a, b) => a.localeCompare(b));

  const result = new Map<string, ResolvedEndpoint[]>();
  let previousMap = new Map<string, ResolvedEndpoint>();

  for (const version of datedVersions) {
    // Start with a copy of the previous version
    const currentMap = new Map(previousMap);
    applyEvents({
      target: currentMap,
      events: events.filter((event) => event.version === version),
    });

    result.set(version, Array.from(currentMap.values()));
    previousMap = currentMap;
  }

  // `latest` = final dated version
  if (datedVersions.length > 0) {
    const latestVersion = datedVersions[datedVersions.length - 1]!;
    result.set(VERSION_LATEST, result.get(latestVersion)!);
  }

  // `preview` endpoints are separate
  const previewEvents = events.filter(
    (event) => event.version === VERSION_PREVIEW,
  );
  if (previewEvents.length > 0) {
    const previewMap = new Map<string, ResolvedEndpoint>();
    applyEvents({ target: previewMap, events: previewEvents });
    result.set(VERSION_PREVIEW, Array.from(previewMap.values()));
  }

  return result;
}
