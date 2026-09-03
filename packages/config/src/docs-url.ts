/**
 * Where the product's "Setup guide ↗", "Schema reference" and "Read the docs"
 * links point, for the deployment doing the asking.
 *
 * On a contributor's own checkout — the standard `make dev` shape, control
 * plane on http://localhost:5560 — assume Mintlify is running alongside it on
 * :3000 and link there, so worktree-scope doc edits round-trip without a
 * deploy. Every other deployment links to the canonical
 * `https://docs.langwatch.ai`.
 *
 * Hostname alone cannot tell a contributor's dev server apart from a packaged
 * self-hosted server (npx @langwatch/server, Docker, Helm): both are commonly
 * reached on localhost, but only the former has Mintlify running alongside it.
 * So the local shortcut also requires a development runtime, which keeps it
 * scoped to contributors while self-hosted installs always get the real,
 * reachable production docs.
 *
 * WHY THIS LIVES IN `@langwatch/config` AND NOT IN A WEB PACKAGE. Five copies
 * of this existed — one per family that wanted a docs link — because a feature
 * package may not import the application and no family owns another. All five
 * read `import.meta.env.DEV` to decide the branch, which is the read
 * `environment-boundaries` refuses: "Reusable packages receive typed
 * configuration". Three of them hid the read behind a cast, which silenced the
 * rule without answering it. The deployment fact they were all reaching for is
 * already on the contract every browser is handed — `PublicAppConfig.mode` —
 * so the honest shape is one framework-free module that RECEIVES that mode,
 * placed where a web package, a contract and an application can all import it
 * without importing each other.
 *
 * The mode arrives through {@link configureDocsRuntime}, called once by the
 * process that boots the browser application, in the same shape as
 * `configureLogger` and `setTraceUrlProvider`. Until it is called the runtime
 * is production: the local docs origin is the one that must never be assumed,
 * because it is also the one the security allowlist in `read-handled-error`
 * derives from (see below).
 */

import type { PublicAppConfig } from "./public-app-config";

const PRODUCTION_DOCS_URL = "https://docs.langwatch.ai";
const LOCAL_DOCS_URL = "http://localhost:3000";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/**
 * The deployment facts a docs link depends on.
 *
 * `mode` is the contract's own field rather than a boolean of our making, so
 * the browser cannot come to a different conclusion about the deployment than
 * the process that served it. `hostname` is the address bar: a package may read
 * that (it is not the environment), but it is a parameter here so a test can
 * pin the branch without mutating jsdom's non-configurable `location`.
 *
 * `"test"` is deliberately NOT a local-docs mode. It is the runtime a suite
 * runs in, not a deployment anybody opens links from, and treating it as
 * development would put `http://localhost:3000` in the allowlist of every test
 * that never asked for it.
 */
export type DocsRuntime = {
  mode: PublicAppConfig["mode"];
  hostname?: string;
};

const PRODUCTION_RUNTIME: DocsRuntime = { mode: "production" };

let installedRuntime: DocsRuntime = PRODUCTION_RUNTIME;

/**
 * Tells this module which deployment it is resolving links for.
 *
 * Called by the application composition root, which is the one place that has
 * both the parsed public configuration and the document it came from.
 */
export function configureDocsRuntime(runtime: DocsRuntime): void {
  installedRuntime = runtime;
}

/** The runtime as configured, for a caller that wants to resolve it itself. */
export function currentDocsRuntime(): DocsRuntime {
  return installedRuntime;
}

/**
 * The docs base URL for an explicitly named runtime.
 *
 * Pure: every branch is decided by the argument, so a test drives it by input
 * rather than by arranging a global.
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
 * The canonical docs base URL, whatever runtime is asking.
 *
 * Named rather than spelled as a constant at the call site so the allowlist in
 * `read-handled-error` stays derived from the module that BUILDS docs links,
 * and cannot drift from what the server actually sends.
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
