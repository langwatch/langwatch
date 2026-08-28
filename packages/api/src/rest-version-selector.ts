import { ApiVersionConflictError, InvalidApiVersionError } from "./errors.js";
import { API_VERSION_HEADER } from "./types.js";
import type { MiddlewareHandler } from "hono";

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
