import type { ComponentType } from "react";
import { reloadOnChunkError } from "./chunk-reload";

/**
 * Wraps a dynamic `import()` for React Router's `lazy`, which keeps the OLD
 * route visible while the new module loads (no gray flash). A stale chunk
 * after a deploy reloads once; every other error falls to the boundary.
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
