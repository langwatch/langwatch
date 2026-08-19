import { useCallback, useState } from "react";
import { showErrorToast } from "~/features/errors";
import type { TargetValue } from "../components/scenarios/TargetSelector";
import { toaster } from "../components/ui/toaster";
import { api } from "../utils/api";
import { pollForScenarioRun } from "../utils/pollForScenarioRun";
import { useModelProvidersSettings } from "./useModelProvidersSettings";

interface RunCompleteResult {
  scenarioRunId: string;
  setId: string;
  batchRunId: string;
}

interface UseRunScenarioOptions {
  projectId: string | undefined;
  projectSlug: string | undefined;
  /** Called when the run completes successfully. Navigate to the result here. */
  onRunComplete?: (result: RunCompleteResult) => void;
  /** Called when the run fails. Use this to show the failed run (e.g., open a drawer). */
  onRunFailed?: (result: RunCompleteResult) => void;
}

interface RunScenarioParams {
  scenarioId: string;
  target: TargetValue;
  setId?: string;
  batchRunId?: string;
}

export function useRunScenario({
  projectId,
  projectSlug,
  onRunComplete,
  onRunFailed,
}: UseRunScenarioOptions) {
  const utils = api.useUtils();
  const runMutation = api.scenarios.run.useMutation();
  const [isPolling, setIsPolling] = useState(false);

  // Check if any model providers are configured
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId,
  });

  const runScenario = useCallback(
    async (params: RunScenarioParams) => {
      const { scenarioId, target, setId, batchRunId } = params;
      if (!projectId || !projectSlug || !target) return;

      // Check if model providers are configured before attempting to run
      if (!hasEnabledProviders) {
        toaster.create({
          title: "No model provider configured",
          description: "A model provider must be configured to run scenarios.",
          type: "error",
          action: {
            label: "Configure model providers",
            onClick: () =>
              window.open(
                "/settings/model-providers",
                "_blank",
                "noopener,noreferrer",
              ),
          },
        });
        return;
      }

      try {
        const { setId: returnedSetId, batchRunId: returnedBatchRunId } =
          await runMutation.mutateAsync({
            projectId,
            scenarioId,
            target: { type: target.type, referenceId: target.id },
            setId,
            batchRunId,
          });

        setIsPolling(true);
        const result = await pollForScenarioRun(
          // The poll asks for the same input up to 60 times over 30s. Under the
          // app-wide staleTime (30_000, see utils/api.tsx) every call after the
          // first would be answered from the first one's cached result, so the
          // loop would never see the run start and would always time out.
          // retry:false is equally load-bearing — fetchQuery only defaults
          // retry off when it is undefined, and the app defines it globally, so
          // one failing request would otherwise burn the entire budget on
          // backoff inside a single attempt.
          (pollParams) =>
            utils.scenarios.getBatchRunData.fetch(pollParams, {
              staleTime: 0,
              retry: false,
            }),
          {
            projectId,
            scenarioSetId: returnedSetId,
            batchRunId: returnedBatchRunId,
          },
        );

        /** Toast action that opens the run, omitted when there is no run to open. */
        const buildViewRunAction = (
          label: string,
          scenarioRunId: string | undefined,
        ) =>
          scenarioRunId
            ? {
                label,
                onClick: () =>
                  onRunFailed?.({
                    scenarioRunId,
                    setId: returnedSetId,
                    batchRunId: returnedBatchRunId,
                  }),
              }
            : undefined;

        if (result.success) {
          onRunComplete?.({
            scenarioRunId: result.scenarioRunId,
            setId: returnedSetId,
            batchRunId: returnedBatchRunId,
          });
        } else if (result.error === "run_failed") {
          // The run executed and did not pass. That is a result, not a fault:
          // no error framing, and the user decides whether to open it rather
          // than being navigated there.
          toaster.create({
            title: "Scenario did not pass",
            description:
              "The run finished. Open it to see the criteria and the reasoning.",
            type: "warning",
            action: buildViewRunAction("View run", result.scenarioRunId),
          });
        } else if (result.error === "run_error") {
          toaster.create({
            title: "Scenario run failed",
            description: "The scenario encountered an error during execution.",
            type: "error",
            action: buildViewRunAction("View failed run", result.scenarioRunId),
          });
        } else {
          toaster.create({
            title: "Run timed out",
            description:
              "The scenario run took too long to start. Please try again.",
            type: "error",
          });
        }
      } catch (error) {
        showErrorToast({ error, fallbackTitle: "Couldn't start the scenario" });
      } finally {
        setIsPolling(false);
      }
    },
    [
      projectId,
      projectSlug,
      hasEnabledProviders,
      runMutation,
      onRunComplete,
      onRunFailed,
      utils,
    ],
  );

  return {
    runScenario,
    isRunning: runMutation.isPending || isPolling,
  };
}
