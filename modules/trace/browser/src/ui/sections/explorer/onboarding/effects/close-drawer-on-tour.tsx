import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useEffect } from "react";

/**
 * Closes any open trace drawer the moment onboarding mounts.
 */
export function CloseDrawerOnTour(): null {
  const { currentDrawer, closeDrawer } = useDrawer();

  useEffect(() => {
    if (currentDrawer) closeDrawer();
    // Run only on mount — once the tour proceeds to the auto-open stage
    // it intentionally opens a sample drawer, and we mustn't immediately
    // re-close it. The mount itself is what we're guarding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
