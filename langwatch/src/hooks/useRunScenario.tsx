import { Button, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import type { TargetValue } from "../components/scenarios/TargetSelector";
import { toaster } from "../components/ui/toaster";
import { api } from "../utils/api";
import { pollForScenarioRun } from "../utils/pollForScenarioRun";
import { buildRoutePath } from "../utils/routes";
import { useModelProvidersSettings } from "./useModelProvidersSettings";

interface UseRunScenarioOptions {
  projectId: string | undefined;
  projectSlug: string | undefined;
}

interface RunScenarioParams {
  scenarioId: string;
  target: TargetValue;
  setId?: string;
}

export function useRunScenario({
  projectId,
  projectSlug,
}: UseRunScenarioOptions) {
  const router = useRouter();
  const utils = api.useContext();
  const runMutation = api.scenarios.run.useMutation();
  const [isPolling, setIsPolling] = useState(false);

  // Check if any model providers are configured
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId,
  });

  const runScenario = useCallback(
    async (params: RunScenarioParams) => {
      const { scenarioId, target, setId } = params;
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
              <Button
                as="a"
                href="/settings/model-providers"
                target="_blank"
                size="xs"
                bg="white"
                color="red.600"
                mt={1}
                _hover={{ bg: "gray.100" }}
              >
                Configure model providers
              </Button>
            </VStack>
          ),
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      try {
        const { setId: returnedSetId, batchRunId } = await runMutation.mutateAsync({
          projectId,
          scenarioId,
          target: { type: target.type, referenceId: target.id },
          setId,
        });

        setIsPolling(true);
        const result = await pollForScenarioRun(
          utils.scenarios.getBatchRunData.fetch,
          { projectId, scenarioSetId: returnedSetId, batchRunId },
        );

        if (result.success) {
          void router.push(
            buildRoutePath("simulations_run", {
              project: projectSlug,
              scenarioSetId: returnedSetId,
              batchRunId,
              scenarioRunId: result.scenarioRunId,
            }),
          );
        } else if (result.error === "run_error") {
          const runPath = result.scenarioRunId
            ? buildRoutePath("simulations_run", {
                project: projectSlug,
                scenarioSetId: returnedSetId,
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
    [projectId, projectSlug, hasEnabledProviders, runMutation, router, utils],
  );

  return {
    runScenario,
    isRunning: runMutation.isPending || isPolling,
  };
}
