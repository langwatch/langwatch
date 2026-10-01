/**
 * Where docs links point, per deployment. Lives here, not @langwatch/config, because its
 * only consumer is the customer-facing error presentation this package owns. Takes a
 * narrowed mode union, not `PublicAppConfig`, so this package gains no config dependency.
 */

const PRODUCTION_DOCS_URL = "https://docs.langwatch.ai";
const LOCAL_DOCS_URL = "http://localhost:3000";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/** The deployment modes a docs link cares about, mirroring `PublicAppConfig["mode"]`
 * without depending on it. */
export type DocsRuntimeMode = "development" | "test" | "production";

/** Deployment facts a docs link depends on (mode, hostname); params avoid environment leakage
 * and test pollution */
export type DocsRuntime = {
  mode: DocsRuntimeMode;
  hostname?: string;
};

const PRODUCTION_RUNTIME: DocsRuntime = { mode: "production" };

let installedRuntime: DocsRuntime = PRODUCTION_RUNTIME;

/**
 * Tells this module which deployment it is resolving links for. Called by the
 * application composition root, the one place holding both the parsed public
 * configuration and the document it came from.
 */
export function configureDocsRuntime(runtime: DocsRuntime): void {
  installedRuntime = runtime;
}

/** The runtime as configured, for a caller that wants to resolve it itself. */
export function currentDocsRuntime(): DocsRuntime {
  return installedRuntime;
}

/**
 * The docs base URL for an explicitly named runtime. Pure: every branch is
 * decided by the argument, so a test drives it by input, not a global.
 */
export function resolveDocsBaseUrl({ mode, hostname }: DocsRuntime): string {
  if (mode === "development" && hostname && LOCAL_HOSTS.has(hostname)) {
    return LOCAL_DOCS_URL;
  }
  return PRODUCTION_DOCS_URL;
}

/** The docs base URL for the runtime this process was configured with. */
export function docsBaseUrl(): string {
  return resolveDocsBaseUrl(installedRuntime);
}

/**
 * The canonical docs base URL, whatever runtime is asking. Named rather than
 * inlined at the call site so the allowlist in `read-handled-error` stays
 * derived from the module that BUILDS docs links, never drifting from it.
 */
export function canonicalDocsBaseUrl(): string {
  return resolveDocsBaseUrl({ mode: "production", hostname: "app.langwatch.ai" });
}

/**
 * Build a docs URL by joining the configured base with a path. The path is
 * taken verbatim — pass leading-slashed paths (`/ai-governance/anomaly-rules`).
 */
export function docsUrl(path: string): string {
  return `${docsBaseUrl()}${path}`;
}
