import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, ZoomIn, ZoomOut } from "react-feather";
import {
  SimulationZoomGrid,
  SetRunHistorySidebar,
} from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

// Main layout for a single Simulation Set page
export function SimulationSetPage({
  scenarioSetId,
}: {
  scenarioSetId: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { goToSimulationSets } = useSimulationRouter();

  const { data: scenarioSetData } =
    api.scenarios.getScenarioSetRunData.useQuery({
      projectId: project?.id ?? "",
      scenarioSetId,
    });

  const scenarioRunIds = scenarioSetData
    ?.map((scenario) => scenario.scenarioRunId)
    .filter(Boolean) as string[];

  return (
    <DashboardLayout>
      <HStack w="full" h="full">
        <SetRunHistorySidebar scenarioSetId={scenarioSetId} />
        <Box w="full" position="relative" h="full">
          <PageLayout.Container
            maxW={"calc(100vw - 200px)"}
            marginTop={0}
            h="full"
            overflow="scroll"
            padding={0}
            position="absolute"
          >
            <SimulationZoomGrid.Root>
              <Box p={6}>
                <Box mb={4}>
                  <SimulationZoomGrid.Controls />
                </Box>
                {scenarioRunIds?.length > 0 && (
                  <SimulationZoomGrid.Grid scenarioRunIds={scenarioRunIds} />
                )}
              </Box>
            </SimulationZoomGrid.Root>
          </PageLayout.Container>
        </Box>
      </HStack>
    </DashboardLayout>
  );
}
