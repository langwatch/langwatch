import {
  DEFAULT_NAVIGATION_MODE,
  useNavigationModeStore,
} from "./navigationModeStore";

/**
 * Which navigation shell this device renders: the stored pick, or the
 * default when the reader never made one. A local read, so the shell
 * resolves on the first frame with no loading state and no flash.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */
export function useNavigationMode() {
  return (
    useNavigationModeStore((state) => state.storedMode) ??
    DEFAULT_NAVIGATION_MODE
  );
}
