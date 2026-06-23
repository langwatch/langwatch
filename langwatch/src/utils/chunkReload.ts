/**
 * Recovery from stale content-hashed chunks after a deploy.
 *
 * Vite emits JS chunks with content-hash filenames (e.g.
 * `react-json-view-CugXrtI-.js`). When a new version is deployed the old hashes
 * are purged from the CDN, but a tab opened *before* the deploy still references
 * them; its next lazy `import()` 404s with "Failed to fetch dynamically imported
 * module".
 *
 * Recovery is *version-aware*. We only reload once we've confirmed the server is
 * serving a newer build than the one this tab booted with — the stale-deploy
 * case a reload provably fixes. A failure with no newer build is persistent (a
 * broken build, an ad-blocker, an offline network); reloading would loop, so
 * those fall through to the error boundary's manual "Reload app" escape hatch
 * instead.
 *
 *  - `handleChunkError` (used by `routes.tsx`'s `page()` helper) and the global
 *    `vite:preloadError` listener provide *reactive* recovery once a chunk has
 *    failed to load.
 *  - `registerDeployWatcher` provides *proactive* recovery: when a backgrounded
 *    tab becomes visible again it reloads for a newer deploy before the user can
 *    navigate into a purged chunk.
 */

// Records the deployed entry we last reloaded toward. A reload that fails to
// land on the new build (e.g. a CDN still serving the old index.html) would
// otherwise loop; the per-target guard caps it at one reload per deployed entry.
const RELOAD_TARGET_KEY = "chunk-reload-target";

/**
 * True when an error looks like a failed chunk download rather than an ordinary
 * runtime error. Browsers phrase this differently (Chrome/Firefox/Safari), so
 * we match all known variants.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = (
    err instanceof Error ? err.message : String(err ?? "")
  ).toLowerCase();
  return (
    msg.includes("loading chunk") ||
    msg.includes("dynamically imported module") ||
    msg.includes("importing a module script failed")
  );
}

function toPath(href: string): string | null {
  try {
    return new URL(href, window.location.href).pathname;
  } catch {
    return null;
  }
}

/** Pull the `/assets/index-<hash>.js` entry path out of an index.html string. */
function entryFromHtml(html: string): string | null {
  const match = /<script[^>]*\bsrc="([^"]*\/assets\/index-[^"]+\.js)"/i.exec(
    html,
  );
  return match?.[1] ? toPath(match[1]) : null;
}

/**
 * The content-hashed entry chunk this tab is running, read from the live DOM.
 * Null when there is none — e.g. the dev server, whose entry is `/src/main.tsx`
 * — which disables version detection (dev has no purged-chunk problem).
 */
function loadedEntry(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  return el ? toPath(el.src) : null;
}

/**
 * Fetch the live index.html (bypassing cache) and return the entry chunk the
 * server is serving IF it differs from this tab's — i.e. a newer deploy is live
 * and a reload will pick up the fresh chunk hashes. Returns null when there's no
 * newer deploy, or when it can't tell (dev, fetch failure, unparseable HTML), so
 * callers make no change.
 */
export async function fetchNewerDeployEntry(): Promise<string | null> {
  const loaded = loadedEntry();
  if (!loaded || typeof fetch === "undefined") return null;
  try {
    const res = await fetch(`${window.location.origin}/`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const deployed = entryFromHtml(await res.text());
    return deployed && deployed !== loaded ? deployed : null;
  } catch {
    return null;
  }
}

/**
 * Reload to pick up a newer deploy, at most once per deployed entry. The
 * per-target guard means a reload that fails to land on the new build can't
 * loop, while every genuinely-new deploy triggers exactly one reload. Returns
 * whether a reload was triggered.
 */
export function reloadForDeploy(deployedEntry: string): boolean {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(RELOAD_TARGET_KEY) === deployedEntry) return false;
  sessionStorage.setItem(RELOAD_TARGET_KEY, deployedEntry);
  window.location.reload();
  return true;
}

/**
 * Reactively recover from a chunk-load error: if a newer deploy is live, reload
 * for it; otherwise do nothing so the error boundary surfaces its manual escape
 * hatch (the failure is persistent, not a stale deploy). Returns true for any
 * chunk-load error (handled), false otherwise so the caller rethrows non-chunk
 * errors.
 */
export function handleChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  void fetchNewerDeployEntry().then((deployedEntry) => {
    if (deployedEntry) reloadForDeploy(deployedEntry);
  });
  return true;
}

/**
 * Register the global reactive recovery for component-level lazy imports (the
 * trace-drawer JSON viewer, Monaco, the Foundry drawer). Vite fires
 * `vite:preloadError` on `window` when a dynamically imported chunk fails.
 */
export function registerChunkReloadListener(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", () => {
    void fetchNewerDeployEntry().then((deployedEntry) => {
      if (deployedEntry) reloadForDeploy(deployedEntry);
    });
  });
}

/**
 * Proactively recover stale tabs: when a backgrounded tab becomes visible again
 * — the moment a tab left open across a deploy is about to be used — reload for
 * a newer deploy before the user navigates into a purged chunk. Registered in
 * `main.tsx`.
 */
export function registerDeployWatcher(): void {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void fetchNewerDeployEntry().then((deployedEntry) => {
      if (deployedEntry) reloadForDeploy(deployedEntry);
    });
  });
}
