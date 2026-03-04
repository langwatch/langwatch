import { Skeleton, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { RunScenarioModal } from "~/components/scenarios/RunScenarioModal";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRunScenario } from "~/hooks/useRunScenario";
import { useScenarioTarget } from "~/hooks/useScenarioTarget";
import { api } from "~/utils/api";
import { Drawer } from "../ui/drawer";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { ScenarioRunActions } from "./ScenarioRunActions";
import { ScenarioRunHeader } from "./ScenarioRunHeader";
import { SimulationConsole } from "./simulation-console/SimulationConsole";

export interface ScenarioRunDetailDrawerProps {
  open?: boolean;
}

export function ScenarioRunDetailDrawer({
  open,
}: ScenarioRunDetailDrawerProps) {
  const { closeDrawer, openDrawer } = useDrawer();
  const params = useDrawerParams();
  const { project } = useOrganizationTeamProject();
  const [runModalOpen, setRunModalOpen] = useState(false);

  const scenarioRunId = params.scenarioRunId;

  const { data: scenarioState } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId && !!open,
    },
  );

  const scenarioId = scenarioState?.scenarioId;

  const { data: scenarioData } =
    api.scenarios.getByIdIncludingArchived.useQuery(
      { projectId: project?.id ?? "", id: scenarioId ?? "" },
      { enabled: !!project?.id && !!scenarioId },
    );

  const { runScenario, isRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
  });

  const {
    target: persistedTarget,
    setTarget: persistTarget,
    hasPersistedTarget,
  } = useScenarioTarget(scenarioId);

  const handleRunAgain = useCallback(
    async (target: TargetValue, remember: boolean) => {
      if (!scenarioId || !target) return;
      if (remember) persistTarget(target);
      try {
        await runScenario({ scenarioId, target });
      } catch (error) {
        console.error("Failed to run scenario:", error);
      }
      setRunModalOpen(false);
    },
    [scenarioId, persistTarget, runScenario],
  );

  const handleRunAgainClick = useCallback(() => {
    if (hasPersistedTarget && persistedTarget) {
      void handleRunAgain(persistedTarget, true);
    } else {
      setRunModalOpen(true);
    }
  }, [hasPersistedTarget, persistedTarget, handleRunAgain]);

  return (
    <>
      <Drawer.Root
        open={!!open}
        onOpenChange={() => {
          closeDrawer();
        }}
        placement="end"
        size="lg"
      >
        <Drawer.Backdrop />
        <Drawer.Content paddingX={0} maxWidth="50%">
          <Drawer.CloseTrigger />
          {!scenarioState && open && (
            <Drawer.Body>
              <VStack gap={4} align="start" w="100%" pt={4}>
                <Skeleton height="32px" width="60%" />
                <Skeleton height="24px" width="40%" />
                <Skeleton height="200px" width="100%" borderRadius="md" />
              </VStack>
            </Drawer.Body>
          )}
          {scenarioState && (
            <>
              <ScenarioRunHeader
                status={scenarioState.status}
                name={scenarioState.name}
                scenarioId={scenarioId}
              />
              <Drawer.Body overflow="auto" px={0} py={0}>
                <VStack gap={0} align="stretch">
                  <SimulationConsole
                    results={scenarioState.results}
                    scenarioName={scenarioState.name ?? undefined}
                    status={scenarioState.status}
                    durationInMs={scenarioState.durationInMs}
                  />
                  <CustomCopilotKitChat
                    messages={scenarioState.messages ?? []}
                    hideInput
                  />
                </VStack>
              </Drawer.Body>
              <Drawer.Footer borderTop="1px" borderColor="border">
                <ScenarioRunActions
                  scenario={scenarioData}
                  isRunning={isRunning}
                  onRunAgain={handleRunAgainClick}
                  onEditScenario={() => {
                    openDrawer("scenarioEditor", {
                      urlParams: { scenarioId: scenarioId ?? "" },
                    });
                  }}
                />
              </Drawer.Footer>
            </>
          )}
        </Drawer.Content>
      </Drawer.Root>

      <RunScenarioModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        onRun={handleRunAgain}
        initialTarget={persistedTarget}
        isLoading={isRunning}
      />
    </>
  );
}
