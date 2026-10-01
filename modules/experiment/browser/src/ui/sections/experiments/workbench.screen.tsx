import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Box, HStack, Spacer, VStack } from "@langwatch/design-system/primitives";
import {
  type ProposalHandlers,
  useRegisterLangyActions,
  useRegisterLangyHandlers,
} from "@langwatch/langy-browser-kit";
import { assertCrispChatHidden, HandledErrorAlert } from "@langwatch/workflow-browser-kit";
import { useEffect, useMemo, useState } from "react";

import { useAutosaveEvaluationsV3 } from "../../../behavior/experiments-v3/use-autosave-evaluations-v3.ts";
import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { useExecuteEvaluation } from "../../../behavior/experiments-v3/use-execute-evaluation.ts";
import { useLambdaWarmup } from "../../../behavior/experiments-v3/use-lambda-warmup.ts";
import { useOptimizeWithLangy } from "../../../behavior/experiments-v3/use-optimize-with-langy.ts";
import { useReportPageActivityToLangy } from "../../../behavior/experiments-v3/use-report-page-activity-to-langy.ts";
import { useSavedDatasetLoader } from "../../../behavior/experiments-v3/use-saved-dataset-loader.ts";
import { useTargetNames } from "../../../behavior/experiments-v3/use-target-name.ts";
import {
  useDatasetProposalHandlers,
  useEvaluatorProposalHandlers,
  usePromptProposalHandlers,
  useWorkbenchProposalHandlers,
} from "../../../behavior/experiments-v3/use-workbench-proposal-handlers.ts";
import { useWorkbenchUiActionHandlers } from "../../../behavior/experiments-v3/use-workbench-ui-action-handlers.ts";
import { useWorkbenchUpdateListener } from "../../../behavior/experiments-v3/use-workbench-update-listener.ts";
import { AutosaveStatus } from "../../../ui/elements/experiments-v3/autosave-status.tsx";
import { EditableHeading } from "../../../ui/elements/experiments-v3/editable-heading.tsx";
import { WorkbenchStaleBanner } from "../../../ui/elements/experiments-v3/workbench-stale-banner.tsx";
import { EvaluationsV3Table } from "../../../ui/sections/experiments-v3/evaluations-v3-table.tsx";
import { HistoryButton } from "../../../ui/sections/experiments-v3/history-button.tsx";
import { PromptTemplateFieldsProvider } from "../../../ui/sections/experiments-v3/prompt-template-fields-provider.tsx";
import { RunEvaluationButton } from "../../../ui/sections/experiments-v3/run-evaluation-button.tsx";
import { SavedDatasetLoaders } from "../../../ui/sections/experiments-v3/saved-dataset-loaders.tsx";
import { TableSettingsMenu } from "../../../ui/sections/experiments-v3/table-settings-menu.tsx";
import { UndoRedo } from "../../../ui/sections/experiments-v3/undo-redo.tsx";
import { VersionHistoryButton } from "../../../ui/sections/experiments-v3/version-history-button.tsx";

/**
 * Experiments Workbench Page
 *
 * Main page for the spreadsheet-like experiment experience.
 */
export default function ExperimentsWorkbenchPage() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug = router.query.slug as string | undefined;

  const { name, setName, datasets, targets, reset, autosaveStatus, addEvaluator } =
    useEvaluationsV3Store((state) => ({
      name: state.name,
      setName: state.setName,
      datasets: state.datasets,
      targets: state.targets,
      reset: state.reset,
      autosaveStatus: state.ui.autosaveStatus,
      addEvaluator: state.addEvaluator,
    }));

  // The columns as their own headers name them, which is also how a run's
  // errors name them. Resolved here, once, because the projection an agent
  // reads is pure and a prompt handle only exists in the database.
  const resolvedTargetNames = useTargetNames(targets);
  const targetNames = useMemo(
    () =>
      Object.fromEntries(
        targets.map((target, index) => [target.id, resolvedTargetNames[index] ?? ""]),
      ),
    [targets, resolvedTargetNames],
  );

  const {
    execute: executeEvaluation,
    status: executionStatus,
    progress: executionProgress,
  } = useExecuteEvaluation();
  // What this page is doing for Langy right now, so the panel's status line
  // can say it. A run reports itself from the execution hook above; an action
  // is over in microseconds but a slow save is not, so the handlers name
  // themselves while they work.
  const [actionActivity, setActionActivity] = useState<string | null>(null);
  // The column being run, named as its own header names it. Captured when the
  // run starts rather than derived here: the header already disambiguates the
  // candidates, which all carry the same prompt handle, and a second
  // derivation is how the panel ends up naming a different column.
  const [runTargetLabel, setRunTargetLabel] = useState<string | null>(null);
  // "Optimize this prompt": hand the column to Langy. The page is the Langy
  // integration point; undefined while flagged off, which hides the menu item.
  const optimizeTarget = useOptimizeWithLangy();

  // Enable autosave for evaluation state - this also handles loading existing experiments
  const {
    isLoading: isLoadingExperiment,
    isNotFound,
    isError,
    error,
    reset: resetAutosave,
    isDirty,
    reloadFromServer,
    saveNow,
  } = useAutosaveEvaluationsV3();

  // A save that lands elsewhere (Langy's backend fallback, the API, another
  // tab) reloads a clean workbench silently and banners a dirty one.
  const { stale: staleWorkbench, reload: reloadStaleWorkbench } = useWorkbenchUpdateListener({
    projectId: project?.id ?? "",
    experimentSlug: typeof slug === "string" ? slug : undefined,
    isDirty,
    reloadFromServer,
  });

  // Track loading state for saved datasets
  const { isLoading: isLoadingDatasets } = useSavedDatasetLoader();

  useReportPageActivityToLangy({
    isRunning: executionStatus === "running",
    runTargetName: runTargetLabel,
    completed: executionProgress.completed,
    total: executionProgress.total,
    actionActivity,
  });

  const evaluatorProposals = useEvaluatorProposalHandlers();
  const workbenchProposals = useWorkbenchProposalHandlers({ addEvaluator, executeEvaluation });
  const promptProposals = usePromptProposalHandlers();
  const datasetProposals = useDatasetProposalHandlers();
  const proposalHandlers = useMemo<ProposalHandlers>(
    () => ({
      ...evaluatorProposals,
      ...workbenchProposals,
      ...promptProposals,
      ...datasetProposals,
    }),
    [evaluatorProposals, workbenchProposals, promptProposals, datasetProposals],
  );

  useRegisterLangyHandlers(proposalHandlers, { experimentSlug: slug });

  const uiActionHandlers = useWorkbenchUiActionHandlers({
    executeEvaluation,
    saveNow,
    targetNames,
    setActionActivity,
    setRunTargetLabel,
  });

  useRegisterLangyActions(uiActionHandlers);

  // Warm up lambda instances in the background (invisible to user)
  useLambdaWarmup();

  // Reset store when leaving the page
  useEffect(() => {
    return () => {
      resetAutosave();
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Crisp bubble policy keeps the support bubble hidden app-wide unless
  // deliberately opened; re-assert on entering the workbench so it can never
  // sit on top of the drawer buttons even if Crisp booted mid-navigation.
  useEffect(() => {
    assertCrispChatHidden();
  }, []);

  // Show 404 if experiment doesn't exist
  if (!slug || isNotFound) {
    return (
      <Box width="full">
        <PageLayout.Container>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Experiment not found</Alert.Title>
            <Alert.Description>
              The experiment you&apos;re looking for doesn&apos;t exist or you don&apos;t have
              access to it.
            </Alert.Description>
          </Alert.Root>
        </PageLayout.Container>
      </Box>
    );
  }

  // Show error for other failures (permissions, network, etc.)
  if (isError) {
    return (
      <Box width="full">
        <PageLayout.Container>
          <HandledErrorAlert error={error} fallbackTitle="Couldn't load this experiment" />
        </PageLayout.Container>
      </Box>
    );
  }

  return (
    <Box width="full">
      <PromptTemplateFieldsProvider>
        <VStack width="full" height="calc(100vh - 50px)" gap={0} align="stretch" overflow="hidden">
          {/* Header */}
          <HStack paddingX={6} paddingTop={5} paddingBottom={3} flexShrink={0}>
            <EditableHeading value={name} onSave={setName} isLoading={isLoadingExperiment} />
            <Spacer />
            <HStack gap={2}>
              <AutosaveStatus
                evaluationState={autosaveStatus.evaluation}
                datasetState={autosaveStatus.dataset}
                evaluationError={autosaveStatus.evaluationError}
                datasetError={autosaveStatus.datasetError}
              />
              <UndoRedo />
              <TableSettingsMenu disabled={isLoadingExperiment} />
              <HistoryButton disabled={isLoadingExperiment} />
              <VersionHistoryButton disabled={isLoadingExperiment} />
              <RunEvaluationButton disabled={isLoadingExperiment || isLoadingDatasets} />
            </HStack>
          </HStack>

          {staleWorkbench && (
            <WorkbenchStaleBanner
              actorLabel={staleWorkbench.actorLabel}
              onReload={reloadStaleWorkbench}
            />
          )}

          {/* Main content - table container with config panel */}
          <Box
            flex={1}
            position="relative"
            overflow="hidden"
            marginLeft={4}
            borderTopLeftRadius="xl"
            borderLeft="1px solid"
            borderTop="1px solid"
            borderColor="border.emphasized"
            bg="bg.panel"
          >
            <Box position="absolute" inset={0} overflow="auto">
              <EvaluationsV3Table
                isLoadingExperiment={isLoadingExperiment}
                isLoadingDatasets={isLoadingDatasets}
                onOptimizeTarget={optimizeTarget}
              />
            </Box>
          </Box>
        </VStack>

        {/* Load saved dataset records - renders nothing, just triggers fetches */}
        <SavedDatasetLoaders datasets={datasets} />
      </PromptTemplateFieldsProvider>
    </Box>
  );
}
