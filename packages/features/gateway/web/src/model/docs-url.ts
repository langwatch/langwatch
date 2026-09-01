/**
 * A family-local copy of `platform/app/src/utils/docsUrl.ts`.
 *
 * Copied rather than shared because a feature-web package may not import the
 * application, and the platform module still has its own callers. The behaviour
 * is carried over unchanged, local Mintlify branch included.
 *
 * The governance family carries the same copy. Two copies rather than a shared
 * module because neither family owns the other, and the shared home this wants
 * is the Design System or a docs contract — a promotion, not a move.
 */

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
 * Hostname alone can't tell a contributor's dev server apart from a
 * packaged self-hosted server (npx @langwatch/server, Docker, Helm):
 * both are commonly reached on localhost, but only the former has
 * Mintlify running alongside it. Also requiring a development build
 * (`import.meta.env.DEV`, false in every packaged/production build,
 * including the self-hosted one) keeps the local-docs shortcut scoped
 * to contributors while self-hosted installs always get the real,
 * reachable production docs.
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
 * `hostname` and `isDev` are exposed as optional overrides so unit tests
 * can pin the branch without mutating `window.location` (jsdom locks the
 * slot with a non-configurable accessor) or the build-time `import.meta.env`
 * constant. Production callers omit both and the helper reads
 * `window.location.hostname` / `import.meta.env.DEV` itself.
 *
 * `import.meta.env` is a Vite-only construct and is `undefined` outside a Vite
 * build, so reading `.DEV` off it unconditionally would throw anywhere this
 * module is loaded by `tsx`. `import.meta.env.DEV` is only ever evaluated
 * inside the same `typeof window !== "undefined"` branch as `window.location`,
 * so a non-browser caller never touches it.
 */
export function getDocsBaseUrl({
  hostname,
  isDev,
}: {
  hostname?: string;
  isDev?: boolean;
} = {}): string {
  const inBrowser = typeof window !== "undefined";
  const resolvedHostname = hostname ?? (inBrowser ? window.location.hostname : undefined);
  // Read through a structural type rather than Vite's ambient one: this module
  // is compiled by four tsconfigs and only one of them names `vite/client`.
  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  const resolvedIsDev = isDev ?? (inBrowser ? viteEnv?.DEV === true : false);
  if (resolvedIsDev && resolvedHostname && LOCAL_HOSTS.has(resolvedHostname)) {
    return LOCAL_DOCS_URL;
  }
  return PRODUCTION_DOCS_URL;
}

/**
 * Convenience: build a docs URL by joining the base with a path. The
 * path is taken verbatim — pass leading-slashed paths
 * (`/ai-gateway/governance/routing-policies`).
 */
export function docsUrl(path: string): string {
  return `${getDocsBaseUrl()}${path}`;
}
