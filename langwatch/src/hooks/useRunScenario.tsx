import { Text, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
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
  const utils = api.useContext();
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
          description: (
            <VStack align="start" gap={1}>
              <Text>
                A model provider must be configured to run scenarios.
              </Text>
              <a
                href="/settings/model-providers"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  padding: "4px 8px",
                  marginTop: "4px",
                  fontSize: "12px",
                  backgroundColor: "white",
                  color: "#c53030",
                  borderRadius: "4px",
                  textDecoration: "none",
                }}
              >
                Configure model providers
              </a>
            </VStack>
          ),
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      try {
        const { setId: returnedSetId, batchRunId: returnedBatchRunId } = await runMutation.mutateAsync({
          projectId,
          scenarioId,
          target: { type: target.type, referenceId: target.id },
          setId,
          batchRunId,
        });

        setIsPolling(true);
        const result = await pollForScenarioRun(
          utils.scenarios.getBatchRunData.fetch,
          { projectId, scenarioSetId: returnedSetId, batchRunId: returnedBatchRunId },
        );

        if (result.success) {
          onRunComplete?.({
            scenarioRunId: result.scenarioRunId,
            setId: returnedSetId,
            batchRunId: returnedBatchRunId,
          });
        } else if (result.error === "run_error") {
          const runResult = result.scenarioRunId
            ? { scenarioRunId: result.scenarioRunId, setId: returnedSetId, batchRunId: returnedBatchRunId }
            : null;
          toaster.create({
            title: "Scenario run failed",
            description: "The scenario encountered an error during execution.",
            type: "error",
            meta: { closable: true },
            action: runResult
              ? {
                  label: "View failed run",
                  onClick: () => onRunFailed?.(runResult),
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
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "An unexpected error occurred";
        toaster.create({
          title: "Failed to start scenario",
          description: message,
          type: "error",
          meta: { closable: true },
        });
      } finally {
        setIsPolling(false);
      }
    },
    [projectId, projectSlug, hasEnabledProviders, runMutation, onRunComplete, onRunFailed, utils],
  );

  return {
    runScenario,
    isRunning: runMutation.isPending || isPolling,
  };
}
