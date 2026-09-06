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
export const RELOAD_AT_KEY = "chunk-reload-at";

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

let warmupsInFlight = 0;

/**
 * The errors that warm-ups caught, so the listener below can tell a download
 * nobody waits for apart from one that a screen is held up by.
 *
 * A `WeakSet` keeps no error alive: an entry goes away with the error itself.
 * A claim that outlives its event is harmless, because Vite builds a new error
 * for every failed import, so no later event can carry the same one.
 */
const warmupFailures = new WeakSet<object>();

/**
 * Run a chunk download that no screen is waiting for, such as a page fetching
 * the code of a drawer its rows open. Reports whether the code arrived.
 *
 * A warm-up asks for a content-hashed file the same way a real lazy import
 * does, so after a deploy it hits the same stale hash and fires the same
 * `vite:preloadError`. Reloading the page for it would take the screen away
 * from a person who asked for nothing, so the listener below drops the failures
 * this function claims. The next import of that chunk still recovers, at the
 * point where somebody is waiting for it.
 */
export async function warmChunk(
  load: () => Promise<unknown>,
): Promise<boolean> {
  warmupsInFlight += 1;
  try {
    await load();
    return true;
  } catch (error) {
    // Claim the failure as this warm-up's own. Nothing on screen is waiting for
    // it, so there is nothing to report to: the open that needs the chunk
    // reports its own failure. The caller gets `false` so it can leave
    // everything as it was.
    if (typeof error === "object" && error !== null) {
      warmupFailures.add(error);
    }
    return false;
  } finally {
    warmupsInFlight -= 1;
  }
}

/**
 * Register the global recovery for component-level lazy imports. Vite fires
 * `vite:preloadError` on `window` whenever a dynamically imported chunk fails
 * to load; the event itself is the chunk-error signal, so we reload directly.
 */
export function registerChunkReloadListener(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (warmupsInFlight === 0) {
      // Only suppress Vite's error when we actually scheduled a reload. If we're
      // inside the cooldown (forceReloadOnce returns false), let the error
      // propagate to the error boundary instead of swallowing it — otherwise the
      // lazy import gets neither recovery nor the normal failure path.
      if (forceReloadOnce()) event.preventDefault();
      return;
    }

    // A warm-up is running, so this failure is either its own or belongs to
    // something a person is waiting for. The event says which import failed
    // only through `payload`, the error Vite is about to throw, so read the
    // answer from `warmChunk` instead: it claims the errors it catches, and a
    // timer runs after every promise callback, so the claim is in by then.
    //
    // An unclaimed failure reloads, which keeps recovery for a stale chunk that
    // a warm-up happens to run next to. An event with no `payload` counts as
    // unclaimed for the same reason: recovery is the more expensive one to
    // lose.
    //
    // The error is left to propagate either way. A warm-up reports nothing, and
    // a real open keeps its normal failure path until the reload lands.
    const { payload } = event as { payload?: unknown };
    setTimeout(() => {
      const claimed =
        typeof payload === "object" &&
        payload !== null &&
        warmupFailures.has(payload);
      if (!claimed) forceReloadOnce();
    }, 0);
  });
}
