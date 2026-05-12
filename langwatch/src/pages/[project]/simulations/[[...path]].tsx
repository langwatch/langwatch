/**
 * Catch-all route for the unified simulations page.
 *
 * Handles all these URL patterns in a SINGLE page file so sidebar
 * navigation uses shallow routing (no full page transition):
 *
 *   /simulations                              → All Runs
 *   /simulations/run-plans/:suiteSlug         → Suite detail
 *   /simulations/run-plans/:suiteSlug/:batchId → Suite + batch highlight
 *   /simulations/:externalSetSlug             → External set
 *   /simulations/:externalSetSlug/:batchId    → External set + batch highlight
 *
 * Also handles legacy redirects:
 *   /simulations/suites?suite=X       → /simulations/run-plans/X
 *   /simulations/suites?externalSet=Y → /simulations/Y
 *   /simulations/:setId/:batchId/:runId → redirect + open drawer
 */
import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import SimulationsPage from "~/components/suites/SimulationsPage";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

function SimulationsRoutePage() {
  const router = useRouter();
  const pathSegments = Array.isArray(router.query.path) ? router.query.path : [];
  const projectSlug = router.query.project as string | undefined;

  // Handle legacy /suites redirect
  useEffect(() => {
    if (!router.isReady || !projectSlug) return;

    if (pathSegments[0] === "suites") {
      const suite = router.query.suite;
      const externalSet = router.query.externalSet;
      if (typeof suite === "string" && suite) {
        void router.replace(`/${projectSlug}/simulations/run-plans/${suite}`);
      } else if (typeof externalSet === "string" && externalSet) {
        void router.replace(`/${projectSlug}/simulations/${externalSet}`);
      } else {
        void router.replace(`/${projectSlug}/simulations`);
      }
      return;
    }

    // Handle /setId/batchId/scenarioRunId redirect → open drawer
    if (pathSegments.length === 3 && pathSegments[0] !== "run-plans") {
      const [setId, batchId, runId] = pathSegments;
      void router.replace(
        `/${projectSlug}/simulations/${setId}/${batchId}?openRun=${runId}`,
      );
    }
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render during redirects
  if (pathSegments[0] === "suites") return null;
  if (pathSegments.length === 3 && pathSegments[0] !== "run-plans") return null;

  return <SimulationsPage />;
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SimulationsRoutePage);
