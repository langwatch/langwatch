/**
 * Where docs links point, per deployment. On dev (Mintlify on :3000), otherwise canonical
 * `https://docs.langwatch.ai`. Lives in @langwatch/config not a web package so it receives
 * typed configuration (`PublicAppConfig.mode`) instead of reads `import.meta.env.DEV`.
 */

import type { PublicAppConfig } from "./public-app-config.ts";

const PRODUCTION_DOCS_URL = "https://docs.langwatch.ai";
const LOCAL_DOCS_URL = "http://localhost:3000";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/** Deployment facts a docs link depends on (mode, hostname); params avoid environment leakage
 * and test pollution */
export type DocsRuntime = {
  mode: PublicAppConfig["mode"];
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
