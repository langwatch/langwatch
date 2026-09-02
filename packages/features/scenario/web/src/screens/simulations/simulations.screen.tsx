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
 * Everything that is not one of those shapes is REDIRECTED rather than rendered
 * as an external set that does not exist — see `resolveSimulationsRedirect` for
 * the rules (the scenario library, the legacy /suites URLs, and the old
 * per-run URL that now opens a drawer).
 */

import { useEffect } from "react";
import SimulationsPage from "../../components/suites/SimulationsPage";
import { resolveSimulationsRedirect } from "../../components/suites/useSuiteRouting";
import { useRouter } from "../../behavior/next-router";

function SimulationsRoutePage() {
  const router = useRouter();
  const pathSegments = Array.isArray(router.query.path) ? router.query.path : [];
  const projectSlug = router.query.project as string | undefined;

  const redirect =
    router.isReady && projectSlug
      ? resolveSimulationsRedirect({
          projectSlug,
          segments: pathSegments,
          query: router.query as Record<string, unknown>,
        })
      : null;

  useEffect(() => {
    if (redirect) void router.replace(redirect);
  }, [redirect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render the wrong page for a frame while the redirect is in flight.
  if (redirect) return null;

  return <SimulationsPage />;
}


/**
 * The guard is the ROUTE's, and it did not travel.
 *
 * `withPermissionGuard("scenarios:view")` and, for Agent Testing,
 * `withFeatureFlagGuard("release_ui_agent_testing_v2_enabled")` state a policy
 * about an ADDRESS — flags before permissions, nothing refused while an answer
 * is still arriving — and the composing application states it in front of the
 * loader, where a refusal can render the application's own fallback. The
 * `layoutComponent: DashboardLayout` half is chrome, and chrome belongs to the
 * route tree.
 */
export default SimulationsRoutePage;
