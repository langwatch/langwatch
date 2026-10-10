import { navigationModeOf, useNavigationModeStore } from "./navigation-mode.store.ts";

/** Which navigation shell to render: the reader's stored pick, or the default. */
export function useNavigationMode() {
  return navigationModeOf(useNavigationModeStore((state) => state.storedMode));
}
