import type { ComponentType } from "react";
import { reloadOnChunkError } from "./chunk-reload";

/**
 * Wraps a dynamic `import()` into the shape React Router's `lazy` expects.
 *
 * React Router's lazy keeps the OLD route visible while the new module loads,
 * eliminating the gray flash that React.lazy + Suspense causes.
 *
 * A stale route chunk after a deploy reloads once so the browser fetches the
 * new content hashes; every other error falls through to the error boundary
 * unchanged. This is the route half of the recovery `registerChunkReloadListener`
 * provides for every other lazy import.
 */
export type LazyRouteModule = { default: ComponentType };

export function lazyRoute(load: () => Promise<LazyRouteModule>): {
  lazy: () => Promise<{ Component: ComponentType }>;
} {
  return {
    lazy: () =>
      load()
        .then((module) => ({ Component: module.default }))
        .catch((error: unknown) => {
          reloadOnChunkError(error);
          throw error;
        }),
  };
}
