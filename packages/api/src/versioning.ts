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
      kind: EndpointRegistration["kind"];
      method: HttpMethod | "sse";
      path: string;
      config: EndpointRegistration["config"];
      withdrawn: true;
    };

/** A composite key for de-duplicating endpoints within a version. */
function endpointKey({ method, path }: { method: string; path: string }): string {
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
      // A withdrawal identifies one HTTP operation, not a URL-shaped family.
      // `GET /things/:id` and `DELETE /things/:id` can have independent
      // lifecycles, so withdrawing either must leave its sibling live.
      const key = endpointKey(ep);
      const inherited = target.get(key);
      if (!inherited) continue;

      target.set(key, {
        kind: inherited.kind,
        method: inherited.method,
        path: inherited.path,
        config: inherited.config,
        withdrawn: true,
      });
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
export function resolveVersions(events: RegistrationEvent[]): Map<string, ResolvedEndpoint[]> {
  const datedVersions = [...new Set(events.map((event) => event.version))].filter(
    (version) => version !== VERSION_PREVIEW,
  );

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

    const endpoints = Array.from(currentMap.values());
    assertNoOverlappingPublicRestRoutes({ endpoints, version });
    result.set(version, endpoints);
    previousMap = currentMap;
  }

  // `latest` = final dated version
  if (datedVersions.length > 0) {
    const latestVersion = datedVersions[datedVersions.length - 1]!;
    result.set(VERSION_LATEST, result.get(latestVersion)!);
  }

  assertPublicRestPolicyParity(result, datedVersions);

  // `preview` endpoints are separate
  const previewEvents = events.filter((event) => event.version === VERSION_PREVIEW);
  if (previewEvents.length > 0) {
    const previewMap = new Map<string, ResolvedEndpoint>();
    applyEvents({ target: previewMap, events: previewEvents });
    const endpoints = Array.from(previewMap.values());
    assertNoOverlappingPublicRestRoutes({ endpoints, version: VERSION_PREVIEW });
    result.set(VERSION_PREVIEW, endpoints);
  }

  return result;
}

/**
 * The bare public REST path chooses a dated stack from a request header. It
 * has one physical Hono mount and one route-policy report, so anything that
 * controls access or transport capability must be identical across its
 * historical registrations. Schemas and handlers may evolve: that is what a
 * date version is for.
 */
function assertPublicRestPolicyParity(
  versionMap: Map<string, ResolvedEndpoint[]>,
  datedVersions: string[],
): void {
  const policies = new Map<string, { fingerprint: string; version: string }>();

  for (const version of datedVersions) {
    for (const endpoint of versionMap.get(version) ?? []) {
      if (endpoint.kind !== "public-rest") continue;

      const key = endpointKey(endpoint);
      const fingerprint = publicRestPolicyFingerprint(endpoint);
      const previous = policies.get(key);
      if (!previous) {
        policies.set(key, { fingerprint, version });
        continue;
      }

      if (previous.fingerprint !== fingerprint) {
        throw new Error(
          `Public REST ${endpoint.method.toUpperCase()} ${endpoint.path || "/"} changes ` +
            `its mounted access policy between ` +
            `${previous.version} and ${version}. Optional-version routes have one mounted policy; ` +
            `register a new non-overlapping path instead.`,
        );
      }
    }
  }
}

function publicRestPolicyFingerprint(endpoint: ResolvedEndpoint): string {
  const config = endpoint.config;
  const policy = {
    auth: config.auth ?? "default",
    permission: config.permission ?? null,
    publicReason: config.noPermission?.reason ?? null,
    rateLimit: config.rateLimit === true,
    resourceLimit: config.resourceLimit ?? null,
    meta: config.meta ?? null,
  };

  try {
    return stableDeclarativeValue(policy);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown non-declarative value";
    throw new Error(
      `Public REST ${endpoint.method.toUpperCase()} ${endpoint.path || "/"} has a ` +
        `non-declarative mounted access policy: ${reason}`,
    );
  }
}

function stableDeclarativeValue(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("cycles are not supported");
    seen.add(value);
    const serialized = `[${value.map((entry) => stableDeclarativeValue(entry, seen)).join(",")}]`;
    seen.delete(value);
    return serialized;
  }
  if (typeof value === "object" && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("only plain objects and arrays are supported");
    }
    if (seen.has(value)) throw new TypeError("cycles are not supported");
    seen.add(value);
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry === void 0) return void 0;
        return `${JSON.stringify(key)}:${stableDeclarativeValue(entry, seen)}`;
      })
      .filter((entry): entry is string => entry !== void 0);
    seen.delete(value);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`${typeof value} values are not supported`);
}

function assertNoOverlappingPublicRestRoutes({
  endpoints,
  version,
}: {
  endpoints: ResolvedEndpoint[];
  version: string;
}): void {
  // A withdrawal is a real 410 route. It still participates in Hono matching,
  // so an active sibling cannot be allowed to overlap it either.
  const publicRestEndpoints = endpoints.filter((endpoint) => endpoint.kind === "public-rest");
  for (const endpoint of publicRestEndpoints) {
    assertSupportedPublicRestPath(endpoint);
  }

  for (let index = 0; index < publicRestEndpoints.length; index++) {
    const left = publicRestEndpoints[index]!;
    for (const right of publicRestEndpoints.slice(index + 1)) {
      if (left.method !== right.method || !pathsOverlap(left.path, right.path)) continue;

      throw new Error(
        `Public REST ${left.method.toUpperCase()} routes "${left.path || "/"}" and ` +
          `"${right.path || "/"}" overlap in version ${version}. Give each operation an ` +
          `unambiguous path shape.`,
      );
    }
  }
}

function assertSupportedPublicRestPath(endpoint: ResolvedEndpoint): void {
  const parameterNames = new Set<string>();
  for (const segment of splitPath(endpoint.path)) {
    if (!segment.startsWith(":")) {
      if (/[?*{}]/.test(segment)) {
        throw unsupportedPublicRestPath(endpoint);
      }
      continue;
    }

    const match = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment);
    const name = match?.[1];
    if (!name || parameterNames.has(name)) {
      throw unsupportedPublicRestPath(endpoint);
    }
    parameterNames.add(name);
  }
}

function unsupportedPublicRestPath(endpoint: ResolvedEndpoint): Error {
  return new Error(
    `Public REST ${endpoint.method.toUpperCase()} route "${endpoint.path || "/"}" uses an ` +
      `unsupported path shape. Modern REST supports literal segments and unique, required, ` +
      `unconstrained :name parameters only`,
  );
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  const left = splitPath(leftPath);
  const right = splitPath(rightPath);
  const sharedLength = Math.min(left.length, right.length);

  for (let index = 0; index < sharedLength; index++) {
    const leftSegment = left[index]!;
    const rightSegment = right[index]!;
    if (leftSegment === "*" || rightSegment === "*") return true;
    if (!segmentsOverlap(leftSegment, rightSegment)) return false;
  }

  if (left.length === right.length) return true;
  return left[sharedLength] === "*" || right[sharedLength] === "*";
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function segmentsOverlap(left: string, right: string): boolean {
  const leftDynamic = left.startsWith(":");
  const rightDynamic = right.startsWith(":");
  if (leftDynamic || rightDynamic) return true;
  return left === right;
}
