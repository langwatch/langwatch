/**
 * Redirect: individual run URL → unified page + open drawer.
 *
 * Old URL: /simulations/:scenarioSetId/:batchRunId/:scenarioRunId
 * New URL: /simulations/:scenarioSetId/:batchRunId?openRun=:scenarioRunId
 */
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function ScenarioRunRedirect() {
  const router = useRouter();
  const { project, scenarioSetId, batchRunId, scenarioRunId } = router.query;

  useEffect(() => {
    if (!router.isReady) return;
    if (!project || !scenarioSetId || !batchRunId || !scenarioRunId) return;

    void router.replace(
      `/${String(project)}/simulations/${String(scenarioSetId)}/${String(batchRunId)}?openRun=${String(scenarioRunId)}`,
    );
  }, [router.isReady, project, scenarioSetId, batchRunId, scenarioRunId, router]);

  return null;
}
