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
 * as an external set that does not exist: see `resolveSimulationsRedirect` for
 * the rules (the scenario library, the legacy /suites URLs, and the old
 * per-run URL that now opens a drawer).
 *
 * A project that reads Agent Testing is sent there for every one of these
 * addresses, so a saved link and a link an older SDK printed both land on the
 * page the project uses. See `useAgentTestingRedirect`.
 */

import { useEffect } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import SimulationsPage from "~/components/suites/SimulationsPage";
import { useAgentTestingRedirect } from "~/components/suites/useAgentTestingRedirect";
import { resolveSimulationsRedirect } from "~/components/suites/useSuiteRouting";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useRouter } from "~/utils/compat/next-router";

function SimulationsRoutePage() {
  const router = useRouter();
  const pathSegments = Array.isArray(router.query.path)
    ? router.query.path
    : [];
  const projectSlug = router.query.project as string | undefined;

  const { deciding } = useAgentTestingRedirect({ segments: pathSegments });

  const redirect =
    !deciding && router.isReady && projectSlug
      ? resolveSimulationsRedirect({
          projectSlug,
          segments: pathSegments,
          query: router.query as Record<string, unknown>,
        })
      : null;

  useEffect(() => {
    if (redirect) void router.replace(redirect);
  }, [redirect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render the wrong page for a frame while a redirect is in flight.
  if (deciding || redirect) return null;

  return <SimulationsPage />;
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SimulationsRoutePage);
