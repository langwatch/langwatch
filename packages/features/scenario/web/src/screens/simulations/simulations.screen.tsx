/**
 * Catch-all route for the unified simulations page.
 */

import { useEffect } from "react";
import SimulationsPage from "../../ui/sections/suites/simulations-page";
import { resolveSimulationsRedirect } from "../../behavior/suites/use-suite-routing";
import { useRouter } from "@langwatch/ui-host/use-router";
import { useAgentTestingRedirect } from "../../behavior/suites/use-agent-testing-redirect";

function SimulationsRoutePage() {
  const router = useRouter();
  // The catch-all segment, read off the route parameters. `/:project/simulations/*`
  // is one page serving five addresses, and the splat is how it knows which.
  const pathSegments = (router.params["*"] ?? "").split("/").filter(Boolean);
  const projectSlug = router.query.project;

  const { deciding } = useAgentTestingRedirect({ segments: pathSegments });

  const redirect =
    !deciding && router.isReady && projectSlug
      ? resolveSimulationsRedirect({
          projectSlug,
          segments: pathSegments,
          query: router.search,
        })
      : null;

  useEffect(() => {
    if (redirect) void router.replace(redirect);
  }, [redirect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render the wrong page for a frame while a redirect is in flight.
  if (deciding || redirect) return null;

  return <SimulationsPage />;
}

/**
 * The guard is the ROUTE's, and it did not travel.
 */
export default SimulationsRoutePage;
