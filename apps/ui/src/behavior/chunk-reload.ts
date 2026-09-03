/**
 * Recovery from stale content-hashed chunks after a deploy.
 *
 * Vite emits JS chunks with content-hash filenames (e.g.
 * `react-json-view-CugXrtI-.js`). When a new version is deployed the old
 * hashes are removed from the CDN, but a tab opened before the deploy still
 * references them. The next lazy `import()` of such a chunk 404s with
 * "Failed to fetch dynamically imported module".
 *
 * Route chunks are guarded by `lazyRoute` in `./lazy-route`; the global
 * `vite:preloadError` listener (registered by the shell adapter) covers every
 * other lazy import by reloading once so the browser fetches fresh hashes.
 */

const RELOAD_COOLDOWN_MS = 10_000;
export const RELOAD_AT_KEY = "chunk-reload-at";

export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("loading chunk") ||
    msg.includes("dynamically imported module") ||
    msg.includes("importing a module script failed")
  );
}

export function forceReloadOnce(): boolean {
  if (typeof window === "undefined") return false;

  const lastReloadAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? "0");
  if (Date.now() - lastReloadAt <= RELOAD_COOLDOWN_MS) return false;

  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

export function reloadOnChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  forceReloadOnce();
  return true;
}

let warmupsInFlight = 0;
const warmupFailures = new WeakSet<object>();

export async function warmChunk(load: () => Promise<unknown>): Promise<boolean> {
  warmupsInFlight += 1;
  try {
    await load();
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      warmupFailures.add(error);
    }
    return false;
  } finally {
    warmupsInFlight -= 1;
  }
}

export function registerChunkReloadListener(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (warmupsInFlight === 0) {
      if (forceReloadOnce()) event.preventDefault();
      return;
    }

    const payload = "payload" in event ? event.payload : void 0;
    setTimeout(() => {
      const claimed =
        typeof payload === "object" && payload !== null && warmupFailures.has(payload);
      if (!claimed) forceReloadOnce();
    }, 0);
  });
}
