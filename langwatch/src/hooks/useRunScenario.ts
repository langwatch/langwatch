import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import type { TargetValue } from "../components/scenarios/TargetSelector";
import { toaster } from "../components/ui/toaster";
import { api } from "../utils/api";
import { pollForScenarioRun } from "../utils/pollForScenarioRun";
import { buildRoutePath } from "../utils/routes";

interface UseRunScenarioOptions {
  projectId: string | undefined;
  projectSlug: string | undefined;
}

export function useRunScenario({
  projectId,
  projectSlug,
}: UseRunScenarioOptions) {
  const router = useRouter();
  const utils = api.useContext();
  const runMutation = api.scenarios.run.useMutation();
  const [isPolling, setIsPolling] = useState(false);

  const runScenario = useCallback(
    async (scenarioId: string, target: TargetValue) => {
      if (!projectId || !projectSlug || !target) return;

      try {
        const { setId, batchRunId } = await runMutation.mutateAsync({
          projectId,
          scenarioId,
          target: { type: target.type, referenceId: target.id },
        });

        setIsPolling(true);
        const result = await pollForScenarioRun(
          utils.scenarios.getBatchRunData.fetch,
          { projectId, scenarioSetId: setId, batchRunId },
        );

        if (result.success) {
          void router.push(
            buildRoutePath("simulations_run", {
              project: projectSlug,
              scenarioSetId: setId,
              batchRunId,
              scenarioRunId: result.scenarioRunId,
            }),
          );
        } else if (result.error === "run_error") {
          const runPath = result.scenarioRunId
            ? buildRoutePath("simulations_run", {
                project: projectSlug,
                scenarioSetId: setId,
                batchRunId,
                scenarioRunId: result.scenarioRunId,
              })
            : null;
          toaster.create({
            title: "Scenario run failed",
            description: "The scenario encountered an error during execution.",
            type: "error",
            meta: { closable: true },
            action: runPath
              ? {
                  label: "View failed run",
                  onClick: () => void router.push(runPath),
                }
              : undefined,
          });
        } else {
          toaster.create({
            title: "Run timed out",
            description:
              "The scenario run took too long to start. Please try again.",
            type: "error",
            meta: { closable: true },
          });
        }
      } catch {
        toaster.create({
          title: "Failed to start scenario",
          description: "An error occurred while starting the scenario run.",
          type: "error",
          meta: { closable: true },
        });
      } finally {
        setIsPolling(false);
      }
    },
    [projectId, projectSlug, runMutation, router, utils],
  );

  return {
    runScenario,
    isRunning: runMutation.isPending || isPolling,
  };
}
