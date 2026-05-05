/**
 * Returns the docs base URL the UI should link to. On localhost
 * dev (the standard `make dev` shape, control plane on
 * http://localhost:5560), assume the developer has Mintlify running
 * locally on :3000 and link there so worktree-scope doc edits
 * round-trip without a deploy. Production / staging deploys link to
 * the canonical `https://docs.langwatch.ai`.
 *
 * Mirrors the gateway base-URL pattern shipped by Sergey c45e69987
 * + Alexis 138685523 — same self-hosted-vs-prod detection shape, just
 * applied to the docs surface so worktree dogfood doesn't have every
 * "Setup guide ↗" / "Schema reference" / "Docs →" link punch out to
 * production.
 *
 * Pure CSR — Vite renders client-side (`createRoot` in main.tsx, no
 * SSR), so reading `window.location` is safe at every render. Falls
 * back to the production URL when `window` is undefined (Node test
 * harness, future SSR migration).
 */

const PRODUCTION_DOCS_URL = "https://docs.langwatch.ai";
const LOCAL_DOCS_URL = "http://localhost:3000";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/**
 * `hostname` is exposed as an optional argument so unit tests can pin
 * the branch without mutating `window.location` (jsdom locks the slot
 * with a non-configurable accessor). Production callers omit it and
 * the helper reads `window.location.hostname` itself.
 */
export function getDocsBaseUrl(hostname?: string): string {
  const resolved =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : undefined);
  if (resolved && LOCAL_HOSTS.has(resolved)) return LOCAL_DOCS_URL;
  return PRODUCTION_DOCS_URL;
}

/**
 * Convenience: build a docs URL by joining the base with a path. The
 * path is taken verbatim — pass leading-slashed paths
 * (`/ai-governance/anomaly-rules`).
 */
export function docsUrl(path: string): string {
  return `${getDocsBaseUrl()}${path}`;
}
