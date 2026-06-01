/**
 * Recovery from stale content-hashed chunks after a deploy.
 *
 * Vite emits JS chunks with content-hash filenames (e.g.
 * `react-json-view-CugXrtI-.js`). When a new version is deployed the old
 * hashes are removed from the CDN, but a tab opened *before* the deploy still
 * references them. The next lazy `import()` of such a chunk 404s with
 * "Failed to fetch dynamically imported module".
 *
 * Route chunks are guarded by the `page()` helper in `routes.tsx`; the global
 * `vite:preloadError` listener (registered in `main.tsx`) covers every other
 * lazy import — the trace-drawer JSON viewer, Monaco, the Foundry drawer — by
 * reloading once so the browser fetches the fresh chunk hashes.
 */

// Minimum gap between self-triggered reloads. Short enough that a second
// deploy mid-session still reloads; long enough to avoid a loop if the server
// is genuinely returning broken chunks.
const RELOAD_COOLDOWN_MS = 10_000;
const RELOAD_AT_KEY = "chunk-reload-at";

/**
 * True when an error looks like a failed chunk download rather than an
 * ordinary runtime error. Browsers phrase this differently
 * (Chrome/Firefox/Safari), so we match all known variants.
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

/**
 * Reload the page at most once per cooldown window. Returns whether a reload
 * was triggered. Guarded by sessionStorage so a server that genuinely serves
 * broken chunks can't trap the user in a reload loop.
 */
export function forceReloadOnce(): boolean {
  if (typeof window === "undefined") return false;

  const lastReloadAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? "0");
  if (Date.now() - lastReloadAt <= RELOAD_COOLDOWN_MS) return false;

  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/**
 * If `err` is a stale-chunk error, reload once to pick up the new hashes.
 * Returns whether the error was a chunk error (the caller should rethrow
 * non-chunk errors so the normal error boundary handles them).
 */
export function reloadOnChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  forceReloadOnce();
  return true;
}

/**
 * Register the global recovery for component-level lazy imports. Vite fires
 * `vite:preloadError` on `window` whenever a dynamically imported chunk fails
 * to load; the event itself is the chunk-error signal, so we reload directly.
 */
export function registerChunkReloadListener(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    // Stop Vite from rethrowing the error to the page; we recover by reloading.
    event.preventDefault();
    forceReloadOnce();
  });
}
