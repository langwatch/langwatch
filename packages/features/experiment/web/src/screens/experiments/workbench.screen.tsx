import { Alert, Box, HStack, Spacer, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { AutosaveStatus } from "../../ui/elements/experiments-v3/autosave-status";
import { EditableHeading } from "../../ui/elements/experiments-v3/editable-heading";
import { EvaluationsV3Table } from "../../ui/sections/experiments-v3/evaluations-v3-table";
import { HistoryButton } from "../../ui/sections/experiments-v3/history-button";
import { PromptTemplateFieldsProvider } from "../../ui/sections/experiments-v3/prompt-template-fields-provider";
import { RunEvaluationButton } from "../../ui/sections/experiments-v3/run-evaluation-button";
import { SavedDatasetLoaders } from "../../ui/sections/experiments-v3/saved-dataset-loaders";
import { TableSettingsMenu } from "../../ui/sections/experiments-v3/table-settings-menu";
import { UndoRedo } from "../../ui/sections/experiments-v3/undo-redo";
import { VersionHistoryButton } from "../../ui/sections/experiments-v3/version-history-button";
import { WorkbenchStaleBanner } from "../../ui/elements/experiments-v3/workbench-stale-banner";
import { useAutosaveEvaluationsV3 } from "../../behavior/experiments-v3/use-autosave-evaluations-v3";
import { useEvaluationsV3Store } from "../../behavior/experiments-v3/use-evaluations-v3-store";
import { useExecuteEvaluation } from "../../behavior/experiments-v3/use-execute-evaluation";
import { useLambdaWarmup } from "../../behavior/experiments-v3/use-lambda-warmup";
import { useOptimizeWithLangy } from "../../behavior/experiments-v3/use-optimize-with-langy";
import { useReportPageActivityToLangy } from "../../behavior/experiments-v3/use-report-page-activity-to-langy";
import { useSavedDatasetLoader } from "../../behavior/experiments-v3/use-saved-dataset-loader";
import { useWorkbenchUpdateListener } from "../../behavior/experiments-v3/use-workbench-update-listener";
import { HandledErrorAlert } from "@langwatch/workflow-web/studio-host/errors";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";
import { assertCrispChatHidden } from "@langwatch/workflow-web/utils/crispBubblePolicy";

/**
 * THE LANGY HANDOFF DID NOT TRAVEL, and it is a real loss rather than an
 * omission. This page registered two things with the agent panel: proposal
 * handlers (`evaluators.create`, `prompts.create`, `dataset.*`) that turned an
 * agent's suggestion into a write plus a "open it" link, and the live UI-action
 * handlers `specs/langy/langy-ui-actions.feature` names. Both hang off
 * `LangyContext`, which lives in `@langwatch/langy-web/src/features/langy/` and
 * is NOT published from that package's entry — and langy-web is another slice's
 * live tree, so widening its exports here would be editing someone else's
 * package mid-flight. The me, automations, analytics and evaluations families
 * each refused the same import for the same reason; this is the fifth.
 *
 * What still works: `useOptimizeWithLangy` (the column's "Optimize this prompt"
 * menu item) and `useReportPageActivityToLangy` (the panel's status line), both
 * of which read the langy STORE rather than the context. What is gone until the
 * context is published: the agent cannot create an evaluator, a prompt or a
 * dataset from this page, and cannot drive the table's actions.
 */

/**
 * Experiments Workbench Page
 *
 * Main page for the spreadsheet-like experiment experience.
 */
export default function ExperimentsWorkbenchPage() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug = router.query.slug as string | undefined;

  const { name, setName, datasets, targets, reset, autosaveStatus } = useEvaluationsV3Store(
    (state) => ({
      name: state.name,
      setName: state.setName,
      datasets: state.datasets,
      targets: state.targets,
      reset: state.reset,
      autosaveStatus: state.ui.autosaveStatus,
    }),
  );

  const {
    execute: executeEvaluation,
    status: executionStatus,
    progress: executionProgress,
  } = useExecuteEvaluation();
  // What this page is doing for Langy right now, so the panel's status line
  // can say it. A run reports itself from the execution hook above; with the
  // agent's own handlers gone (see the note above) nothing else sets this, so
  // it stays null and the line reads off the run alone.
  const [actionActivity] = useState<string | null>(null);
  // The column being run, named as its own header names it. It was set from
  // the agent's run handler, which did not travel, so the status line names no
  // column until a reader-started run reports one.
  const [runTargetLabel] = useState<string | null>(null);
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
      <Box width="full" background="bg.panel">
        <Box padding={6}>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Experiment not found</Alert.Title>
            <Alert.Description>
              The experiment you&apos;re looking for doesn&apos;t exist or you don&apos;t have
              access to it.
            </Alert.Description>
          </Alert.Root>
        </Box>
      </Box>
    );
  }

  // Show error for other failures (permissions, network, etc.)
  if (isError) {
    return (
      <Box width="full" background="bg.panel">
        <Box padding={6}>
          <HandledErrorAlert error={error} fallbackTitle="Couldn't load this experiment" />
        </Box>
      </Box>
    );
  }

  return (
    <Box width="full" background="bg.panel">
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
