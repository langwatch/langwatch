import { useEffect } from "react";
import { useDrawer } from "~/hooks/useDrawer";

/**
 * Closes any open trace drawer the moment onboarding mounts. Without this
 * an existing user who triggers the Tour from the toolbar (or a new user
 * who hard-reloads onto a `?traceId=` URL) ends up with the live drawer
 * sitting next to mock preview rows — the drawer queries fire against a
 * trace ID that the table is no longer surfacing, leaving the drawer in
 * a confusing stale state and blocking the tour's drawer-glow stage from
 * pointing at a clean target.
 *
 * Mounts only inside `OnboardingHost` (gated by `useOnboardingActive`),
 * so users not in the journey never see this effect run.
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
