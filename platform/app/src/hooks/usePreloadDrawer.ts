import { useEffect } from "react";
import { type DrawerType, preloadDrawer } from "~/components/drawerRegistry";

/**
 * Upper bound on the wait for an idle moment. A screen that never goes idle
 * still warms its drawers, only later than a quiet one.
 */
const IDLE_TIMEOUT_MS = 2_000;

/** The wait on browsers that have no idle callback. */
const IDLE_FALLBACK_MS = 500;

/**
 * Fetch the code of the drawers this screen opens, once the browser is idle.
 *
 * Idle rather than on mount: the screen's own data is what the person waits
 * for, and a warm-up next to it competes for the same connections and makes
 * the visible wait longer. See `preloadDrawer` for what the warm-up buys.
 */
export function usePreloadDrawer(...types: DrawerType[]): void {
  // The rest parameter is a new array on every render. The joined names are
  // the stable identity of the list.
  const typeList = types.join(",");

  useEffect(() => {
    if (!typeList) return;

    const warm = () => {
      for (const type of typeList.split(",") as DrawerType[]) {
        void preloadDrawer(type);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, {
        timeout: IDLE_TIMEOUT_MS,
      });
      return () => window.cancelIdleCallback(handle);
    }

    const handle = window.setTimeout(warm, IDLE_FALLBACK_MS);
    return () => window.clearTimeout(handle);
  }, [typeList]);
}
