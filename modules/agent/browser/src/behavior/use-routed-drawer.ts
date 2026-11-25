import { useDrawer } from "@langwatch/browser-host/drawer";

/** How a drawer opened by address leaves: back along the stack when it can, else closed. */
export function useRoutedDrawer() {
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  return { close: closeDrawer, ...(canGoBack ? { goBack } : {}) };
}
