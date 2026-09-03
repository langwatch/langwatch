/**
 * Warming a drawer's code before someone opens it.
 *
 * Moved out of `platform/app/src/hooks/usePreloadDrawer.ts`. The hook there
 * read the one module-scope registry and the application's own `warmChunk`
 * directly; both are composition now, so the host builds a preloader once from
 * its composed registry and publishes the pair.
 */

import { useEffect } from "react";

import { preloadDrawer, type UiDrawerRegistry } from "../model/drawer-registry";

/**
 * Upper bound on the wait for an idle moment. A screen that never goes idle
 * still warms its drawers, only later than a quiet one.
 */
const IDLE_TIMEOUT_MS = 2_000;

/** The wait on browsers that have no idle callback. */
const IDLE_FALLBACK_MS = 500;

export type DrawerPreloader = {
  /** Fetch one drawer's code now. */
  preload: (drawer: string) => Promise<void>;
  /**
   * Fetch the code of the drawers this screen opens, once the browser is idle.
   *
   * Idle rather than on mount: the screen's own data is what the person waits
   * for, and a warm-up next to it competes for the same connections and makes
   * the visible wait longer.
   */
  usePreload: (...drawers: string[]) => void;
};

export function createDrawerPreloader({
  registry,
  warm,
}: {
  registry: UiDrawerRegistry;
  warm?: (load: () => Promise<unknown>) => Promise<boolean>;
}): DrawerPreloader {
  const preload = (drawer: string) =>
    preloadDrawer({ registry, drawer, ...(warm ? { warm } : {}) });

  return { preload, usePreload: makeUsePreload(preload) };
}

/** The idle-wait hook, over whichever preload it was built with. */
export function makeUsePreload(
  preload: (drawer: string) => Promise<void>,
): (...drawers: string[]) => void {
  return function usePreloadDrawer(...types: string[]): void {
    // The rest parameter is a new array on every render. The joined names are
    // the stable identity of the list.
    const typeList = types.join(",");

    useEffect(() => {
      if (!typeList) return;

      const warmAll = () => {
        for (const type of typeList.split(",")) void preload(type);
      };

      if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(warmAll, {
          timeout: IDLE_TIMEOUT_MS,
        });
        return () => window.cancelIdleCallback(handle);
      }

      const handle = window.setTimeout(warmAll, IDLE_FALLBACK_MS);
      return () => window.clearTimeout(handle);
    }, [typeList]);
  };
}
