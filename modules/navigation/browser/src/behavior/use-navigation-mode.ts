import { useEffect } from "react";

import {
  DEFAULT_NAVIGATION_MODE,
  loadStoredNavigationMode,
  useNavigationModeStore,
} from "./navigation-mode.store.ts";

/** Which navigation shell to render; stored pick applied after mount to avoid hydration mismatch */
export function useNavigationMode() {
  const storedMode = useNavigationModeStore((state) => state.storedMode);
  const hydrateStoredMode = useNavigationModeStore((state) => state.hydrateStoredMode);

  useEffect(() => {
    hydrateStoredMode(loadStoredNavigationMode());
  }, [hydrateStoredMode]);

  return storedMode ?? DEFAULT_NAVIGATION_MODE;
}
