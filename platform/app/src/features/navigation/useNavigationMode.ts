import { useEffect } from "react";
import {
  DEFAULT_NAVIGATION_MODE,
  loadStoredNavigationMode,
  useNavigationModeStore,
} from "./navigationModeStore";

/**
 * Which navigation shell this device renders: the stored pick, or the
 * default when the reader never made one.
 *
 * Server-side (and the first client frame it hydrates against) always
 * resolves to the default so the top-level DOM the server sent is what
 * the client renders on the first pass. The device's saved pick is
 * applied after mount, so the shell may switch to the icon rail on the
 * second frame without a hydration mismatch on the outer chrome.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
export function useNavigationMode() {
  const storedMode = useNavigationModeStore((state) => state.storedMode);
  const hydrateStoredMode = useNavigationModeStore(
    (state) => state.hydrateStoredMode,
  );

  useEffect(() => {
    hydrateStoredMode(loadStoredNavigationMode());
  }, [hydrateStoredMode]);

  return storedMode ?? DEFAULT_NAVIGATION_MODE;
}
