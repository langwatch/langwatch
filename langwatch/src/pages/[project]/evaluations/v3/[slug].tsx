import { Box, HStack, Spacer, VStack } from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { CurrentDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { AutosaveStatus } from "~/evaluations-v3/components/AutosaveStatus";
import { EditableHeading } from "~/evaluations-v3/components/EditableHeading";
import { EvaluationsV3Table } from "~/evaluations-v3/components/EvaluationsV3Table";
import { HistoryButton } from "~/evaluations-v3/components/HistoryButton";
import { RowHeightToggle } from "~/evaluations-v3/components/RowHeightToggle";
import { RunEvaluationButton } from "~/evaluations-v3/components/RunEvaluationButton";
import { SavedDatasetLoaders } from "~/evaluations-v3/components/SavedDatasetLoaders";
import { UndoRedo } from "~/evaluations-v3/components/UndoRedo";
import { useAutosaveEvaluationsV3 } from "~/evaluations-v3/hooks/useAutosaveEvaluationsV3";
import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";
import { useSavedDatasetLoader } from "~/evaluations-v3/hooks/useSavedDatasetLoader";

/**
 * Evaluations V3 Page
 *
 * Main page for the new spreadsheet-like evaluation experience.
 */
export default function EvaluationsV3Page() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug = router.query.slug as string | undefined;

  const { name, setName, datasets, reset, autosaveStatus } =
    useEvaluationsV3Store((state) => ({
      name: state.name,
      setName: state.setName,
      datasets: state.datasets,
      reset: state.reset,
      autosaveStatus: state.ui.autosaveStatus,
    }));

  // Enable autosave for evaluation state - this also handles loading existing experiments
  const { isLoading: isLoadingExperiment } = useAutosaveEvaluationsV3();

  // Track loading state for saved datasets
  const { isLoading: isLoadingDatasets } = useSavedDatasetLoader();

  // Reset store when leaving the page
  useEffect(() => {
    return () => {
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) {
    return <LoadingScreen />;
  }

  if (!slug) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout backgroundColor="white" compactMenu={true}>
      <VStack
        width="full"
        height="calc(100vh - 50px)"
        gap={0}
        align="stretch"
        overflow="hidden"
      >
        {/* Header */}
        <HStack paddingX={6} paddingY={3} flexShrink={0}>
          <EditableHeading
            value={name}
            onSave={setName}
            isLoading={isLoadingExperiment}
          />
          <Spacer />
          <HStack gap={2}>
            <AutosaveStatus
              evaluationState={autosaveStatus.evaluation}
              datasetState={autosaveStatus.dataset}
              evaluationError={autosaveStatus.evaluationError}
              datasetError={autosaveStatus.datasetError}
            />
            <UndoRedo />
            <RowHeightToggle />
            <HistoryButton disabled={isLoadingExperiment} />
            <RunEvaluationButton disabled={isLoadingExperiment || isLoadingDatasets} />
          </HStack>
        </HStack>

        {/* Main content - table container with config panel */}
        <Box
          flex={1}
          position="relative"
          overflow="hidden"
          marginLeft={4}
          marginTop={2}
          borderTopLeftRadius="xl"
          borderLeft="1px solid"
          borderTop="1px solid"
          borderColor="gray.350"
          bg="white"
        >
          <Box position="absolute" inset={0} overflow="auto">
            <EvaluationsV3Table
              isLoadingExperiment={isLoadingExperiment}
              isLoadingDatasets={isLoadingDatasets}
            />
          </Box>
        </Box>
      </VStack>

      {/* Load saved dataset records - renders nothing, just triggers fetches */}
      <SavedDatasetLoaders datasets={datasets} />
    </DashboardLayout>
  );
}
