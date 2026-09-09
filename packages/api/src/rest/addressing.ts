/**
 * How a REST family is addressed: the version vocabulary it serves at, the
 * `/api/v1` alias every `/api` family answers under, the static generation a
 * hand-mounted transport negotiates, and the paths one route answers at under
 * each of the four addressings.
 */
import { Temporal } from "@langwatch/time";
import type { Hono, MiddlewareHandler } from "hono";
import { uniqueSymbol } from "hono-openapi";

import { ApiVersionConflictError, InvalidApiVersionError } from "../errors.ts";
import type { RestTransportDeclaration, RestTransportRoute } from "./declaration.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Version primitives.
// ─────────────────────────────────────────────────────────────────────────────

/** A date-based API version string, e.g. `"2025-03-15"`. Validated at runtime. */
export type DateVersion = string;

export const VERSION_LATEST = "latest" as const;
export const VERSION_PREVIEW = "preview" as const;
export const API_VERSION_HEADER = "X-API-Version" as const;

/**
 * The version argument of a registration: a real calendar date, or `"preview"`
 * for an endpoint that lives only in the preview namespace. `"latest"` is
 * derived, never registered.
 */
export type VersionLabel = DateVersion | typeof VERSION_PREVIEW;

/** The version status header value a mount responds with. */
export type VersionStatus = "stable" | "latest" | "preview";

/**
 * `head` is registered for the registry and the published document only: Hono
 * answers a HEAD request from the GET route BEFORE routing, so a HEAD handler
 * never runs. Register it beside the GET whose headers it describes.
 */
export type HttpMethod = "get" | "head" | "post" | "put" | "delete" | "patch";

/** A family's Hono app as a mount target. */
export type MountableRestApp = Hono<any, any, any>;

/**
 * The one dated version every management API family serves.
 *
 * The management surface shipped as a single product decision, so its families
 * version together: a caller pins `/api/<family>/2026-08-07/...` and gets the
 * same vintage everywhere, and a future breaking change bumps this constant in
 * exactly one place per family.
 */
export const MANAGEMENT_API_VERSION = "2026-08-07";

const DATE_VERSION_RE = /^20\d{2}-\d{2}-\d{2}$/;

/** Returns true when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isDateVersion(value: string): value is DateVersion {
  if (!DATE_VERSION_RE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = Temporal.PlainDate.from({ year: year!, month: month!, day: day! });

  return date.year === year && date.month === month && date.day === day;
}

/** Asserts the version argument of a declaration. */
export function assertVersionLabel(version: string): void {
  if (version === VERSION_PREVIEW) return;
  if (version === VERSION_LATEST) {
    throw new Error(
      `API version "latest" is derived from the dated registrations and ` +
        `cannot be registered; name a real date in YYYY-MM-DD form`,
    );
  }
  if (!isDateVersion(version)) {
    throw new RangeError(
      `Invalid API version "${version}"; expected a real date in YYYY-MM-DD form`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The canonical `/api/v1` alias every `/api` family answers under.
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical published API generation. */
export const V1_PREFIX = "/api/v1";

const VERSION_SEGMENT = /^v\d+$/;

/**
 * The `/api/v1` form of a bare `/api/...` route path, or `null` when the path
 * must not be aliased.
 */
export function canonicalV1Path(path: string): string | null {
  if (path !== "/api" && !path.startsWith("/api/")) return null;
  const rest = path.slice("/api".length);
  if (rest === "" || rest === "/") return null;
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => VERSION_SEGMENT.test(segment))) return null;
  return `${V1_PREFIX}${rest}`;
}

/** The same handler stack with hono-openapi's route metadata detached. */
export function undescribedStack(stack: readonly MiddlewareHandler[]): MiddlewareHandler[] {
  return stack.map((handler) => {
    if (Reflect.get(handler, uniqueSymbol) === void 0) return handler;
    const passthrough: MiddlewareHandler = async (context, next) => handler(context, next);
    return passthrough;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Static generation selection, for a surface whose contract is a generation
// rather than a date.
// ─────────────────────────────────────────────────────────────────────────────

export type RestVersionSource = "path" | "header" | "latest";

export type RestVersionSelection = Readonly<{
  version: string;
  source: RestVersionSource;
}>;

export type RestVersionSelectorOptions = Readonly<{
  versions: readonly string[];
  latestVersion: string;
  headerName?: string;
}>;

export type RestVersionSelectorMiddlewareOptions = Readonly<{
  selector: RestVersionSelector;
  pathVersion?: string;
}>;

/**
 * Selects a static public-REST generation independently from date contract
 * negotiation. A feature mount supplies its explicit path generation, if any.
 */
export class RestVersionSelector {
  static create(options: RestVersionSelectorOptions): RestVersionSelector {
    return new RestVersionSelector(options);
  }

  readonly headerName: string;
  private readonly versions: ReadonlySet<string>;
  private readonly latestVersion: string;

  private constructor({
    headerName = API_VERSION_HEADER,
    latestVersion,
    versions,
  }: RestVersionSelectorOptions) {
    if (versions.length === 0) {
      throw new Error("REST version selector requires at least one supported version");
    }
    if (new Set(versions).size !== versions.length) {
      throw new Error("REST version selector versions must be unique");
    }
    if (versions.some((version) => version.trim() === "")) {
      throw new Error("REST version selector versions must not be blank");
    }
    if (!versions.includes(latestVersion)) {
      throw new Error("REST version selector latestVersion must be supported");
    }
    if (headerName.trim() === "") {
      throw new Error("REST version selector headerName must not be blank");
    }

    this.headerName = headerName;
    this.versions = new Set(versions);
    this.latestVersion = latestVersion;
  }

  select({
    pathVersion,
    headerVersion,
  }: Readonly<{ pathVersion?: string; headerVersion?: string }>): RestVersionSelection {
    if (pathVersion !== void 0 && headerVersion !== void 0 && pathVersion !== headerVersion) {
      throw new ApiVersionConflictError();
    }
    if (pathVersion !== void 0) {
      this.assertSupported(pathVersion);
    }
    if (headerVersion !== void 0) {
      this.assertSupported(headerVersion);
    }
    if (pathVersion !== void 0) {
      return { version: pathVersion, source: "path" };
    }
    if (headerVersion !== void 0) {
      return { version: headerVersion, source: "header" };
    }
    return { version: this.latestVersion, source: "latest" };
  }

  private assertSupported(version: string): void {
    if (!this.versions.has(version)) {
      const supported = [...this.versions].join(", ");
      throw new InvalidApiVersionError(`one of ${supported}`);
    }
  }
}

/** Applies static generation negotiation to a hand-mounted REST transport. */
export function restVersionSelectorMiddleware({
  pathVersion,
  selector,
}: RestVersionSelectorMiddlewareOptions): MiddlewareHandler {
  return async (context, next) => {
    const selection = selector.select({
      pathVersion,
      headerVersion: context.req.header(selector.headerName) ?? void 0,
    });
    try {
      await next();
    } finally {
      context.header(API_VERSION_HEADER, selection.version);
      context.header("X-API-Version-Status", selection.source === "latest" ? "latest" : "stable");
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// How a family is addressed, and the paths each addressing publishes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a family is addressed: `dated` publishes its dated, latest and bare
 * paths with their `/api/v1` twins; `v1-only` and `v1-in-path` publish one
 * generation, which is their whole contract; `literal` publishes exactly the
 * paths its routes write, for a family sharing a prefix rather than owning it.
 */
export type RestAddressing = "dated" | "v1-only" | "v1-in-path" | "literal";

/**
 * What a family may say about its addresses: `v1Twin: false` for one whose
 * paths were never aliased, and the `generation` a `v1-in-path` family names
 * in its own path, for a protocol whose generation is not ours to choose.
 */
export type RestAddressingOptions = Readonly<{ v1Twin?: boolean; generation?: string }>;

/** The generation a family names in its own path, when it names one: `v2`. */
export const DEFAULT_GENERATION = "v1";

/** What each addressing lets a family say about its own addresses. */
export function assertAddressingOptions({
  namespace,
  addressing,
  options,
}: {
  namespace: string;
  addressing: RestAddressing;
  options: RestAddressingOptions;
}): void {
  const twinless = addressing === "v1-only" || addressing === "v1-in-path";

  if (options.v1Twin !== void 0 && twinless) {
    throw new Error(
      `REST "${namespace}" addresses itself "${addressing}", which names its ` +
        "generation in the path and so has no /api/v1 twin to declare",
    );
  }

  if (options.generation === void 0) return;

  if (addressing !== "v1-in-path") {
    throw new Error(
      `REST "${namespace}" addresses itself "${addressing}", which names no generation ` +
        "in its own path",
    );
  }

  if (!VERSION_SEGMENT.test(options.generation)) {
    throw new Error(
      `REST "${namespace}" names the generation "${options.generation}" in its path; a ` +
        "generation is spelled v1, v2 and so on",
    );
  }
}

/** Where the family's routes hang, by the way it addresses itself. */
export function basePathOf(declaration: RestTransportDeclaration<unknown>): string {
  switch (declaration.addressing) {
    case "v1-only":
      return `${V1_PREFIX}/${declaration.namespace}`;
    case "v1-in-path":
      return `/api/${declaration.namespace}/${declaration.generation}`;
    case "dated":
      return `/api/${declaration.namespace}`;
    // A family sharing a prefix owns none of it: each route's own path is the
    // whole address, so there is no base to hang them off.
    case "literal":
      return "";
  }
}

/**
 * Where the family's own middleware applies. A family owning a prefix claims
 * it whole; a literal family claims exactly the addresses it declares, because
 * a wildcard would run ahead of a sibling family sharing the prefix.
 */
export function middlewareScopesOf(declaration: RestTransportDeclaration<unknown>): string[] {
  const basePath = basePathOf(declaration);

  if (declaration.addressing !== "literal") {
    const aliasPath = declaration.v1Twin ? canonicalV1Path(basePath) : null;

    return aliasPath ? [`${basePath}/*`, `${aliasPath}/*`] : [`${basePath}/*`];
  }

  const scopes = new Set<string>();

  for (const route of declaration.routes) {
    scopes.add(route.path);

    const alias = declaration.v1Twin ? canonicalV1Path(route.path) : null;

    if (alias) scopes.add(alias);
  }

  return [...scopes];
}

/** The addresses one route answers at, and what each one reports. */
export function addressesOf({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): readonly {
  path: string;
  context: { version: string; status: VersionStatus; suffix?: string };
}[] {
  const version = declaration.version;
  // A collection route's path is the family root, so it contributes nothing to
  // an address: concatenating it would date the namespace as `/<version>/`,
  // which no caller sends and a sibling `/:id` answers instead.
  const suffix = route.path === "/" ? "" : route.path;

  // A family that names its generation in the path has that generation as its
  // whole contract, and a literal family's route path IS its address: one
  // address either way, no dated namespace, no latest alias, and nothing for a
  // date to fall back to.
  if (declaration.addressing !== "dated") {
    return [{ path: suffix || "/", context: { version, status: "stable" } }];
  }

  return [
    { path: `/${version}${suffix}`, context: { version, status: "stable", suffix: dated(version) } },
    {
      path: `/${VERSION_LATEST}${suffix}`,
      context: { version: VERSION_LATEST, status: "latest", suffix: VERSION_LATEST },
    },
    { path: suffix || "/", context: { version: VERSION_LATEST, status: "latest" } },
  ];
}

function dated(version: string): string {
  return version.replaceAll("-", "_");
}
