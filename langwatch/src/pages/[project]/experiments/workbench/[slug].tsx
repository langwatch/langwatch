import { Alert, Box, HStack, Spacer, VStack } from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useRouter } from "~/utils/compat/next-router";
import { useEffect, useMemo, useState } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import {
  SageDrawer,
  type ProposalHandlers,
} from "~/components/sage/SageSidebar";
import { LoadingScreen } from "~/components/LoadingScreen";
import { AutosaveStatus } from "~/evaluations-v3/components/AutosaveStatus";
import { EditableHeading } from "~/evaluations-v3/components/EditableHeading";
import { EvaluationsV3Table } from "~/evaluations-v3/components/EvaluationsV3Table";
import { HistoryButton } from "~/evaluations-v3/components/HistoryButton";
import { RunEvaluationButton } from "~/evaluations-v3/components/RunEvaluationButton";
import { SavedDatasetLoaders } from "~/evaluations-v3/components/SavedDatasetLoaders";
import { TableSettingsMenu } from "~/evaluations-v3/components/TableSettingsMenu";
import { UndoRedo } from "~/evaluations-v3/components/UndoRedo";
import { useAutosaveEvaluationsV3 } from "~/evaluations-v3/hooks/useAutosaveEvaluationsV3";
import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";
import { useExecuteEvaluation } from "~/evaluations-v3/hooks/useExecuteEvaluation";
import { useLambdaWarmup } from "~/evaluations-v3/hooks/useLambdaWarmup";
import { useSavedDatasetLoader } from "~/evaluations-v3/hooks/useSavedDatasetLoader";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Experiments Workbench Page
 *
 * Main page for the spreadsheet-like experiment experience.
 */
export default function ExperimentsWorkbenchPage() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug = router.query.slug as string | undefined;

  const {
    name,
    setName,
    datasets,
    reset,
    autosaveStatus,
    addEvaluator,
    removeEvaluator,
  } = useEvaluationsV3Store((state) => ({
    name: state.name,
    setName: state.setName,
    datasets: state.datasets,
    reset: state.reset,
    autosaveStatus: state.ui.autosaveStatus,
    addEvaluator: state.addEvaluator,
    removeEvaluator: state.removeEvaluator,
  }));

  const createEvaluator = api.evaluators.create.useMutation();
  const updateEvaluator = api.evaluators.update.useMutation();
  const deleteEvaluator = api.evaluators.delete.useMutation();
  const createPrompt = api.prompts.create.useMutation();
  const updatePrompt = api.prompts.update.useMutation();
  const upsertDataset = api.dataset.upsert.useMutation();
  const createDatasetRecords = api.datasetRecord.create.useMutation();
  const utils = api.useContext();
  const { execute: executeEvaluation } = useExecuteEvaluation();
  const { openDrawer } = useDrawer();

  // Enable autosave for evaluation state - this also handles loading existing experiments
  const {
    isLoading: isLoadingExperiment,
    isNotFound,
    isError,
    error,
    reset: resetAutosave,
  } = useAutosaveEvaluationsV3();

  // Track loading state for saved datasets
  const { isLoading: isLoadingDatasets } = useSavedDatasetLoader();

  const proposalHandlers = useMemo<ProposalHandlers>(() => {
    const projectId = project?.id;
    const projectSlug = project?.slug;
    if (!projectId) return {} as ProposalHandlers;
    return {
      "evaluators.create": async (payload) => {
        const { name, type, config } = payload as {
          name: string;
          type: "evaluator" | "workflow";
          config: Record<string, unknown>;
        };
        const created = await createEvaluator.mutateAsync({
          projectId,
          name,
          type,
          config,
        });
        await utils.evaluators.getAll.invalidate({ projectId });
        const evaluatorType = (created?.config as {
          evaluatorType?: string;
        } | null)?.evaluatorType;
        return {
          label: "Edit evaluator",
          onOpen: () =>
            openDrawer("evaluatorEditor", {
              evaluatorId: created.id,
              evaluatorType,
            }),
        };
      },
      "evaluators.update": async (payload) => {
        const { id, name, config, evaluatorType } = payload as {
          id: string;
          name?: string;
          config: Record<string, unknown>;
          evaluatorType?: string;
        };
        await updateEvaluator.mutateAsync({
          projectId,
          id,
          ...(name ? { name } : {}),
          config,
        });
        await utils.evaluators.getAll.invalidate({ projectId });
        return {
          label: "Edit evaluator",
          onOpen: () =>
            openDrawer("evaluatorEditor", {
              evaluatorId: id,
              evaluatorType,
            }),
        };
      },
      "evaluators.delete": async (payload) => {
        const { id } = payload as { id: string };
        await deleteEvaluator.mutateAsync({ projectId, id });
        await utils.evaluators.getAll.invalidate({ projectId });
        // Drop any workbench columns that referenced the archived evaluator
        // so the table reflects the delete immediately.
        const current = useEvaluationsV3Store.getState().evaluators;
        for (const entry of current) {
          if (entry.dbEvaluatorId === id) {
            useEvaluationsV3Store.getState().removeEvaluator(entry.id);
          }
        }
        return undefined;
      },
      "workbench.addEvaluator": async (payload) => {
        const { dbEvaluatorId, evaluatorType, name, fields } = payload as {
          dbEvaluatorId: string;
          evaluatorType: string;
          name: string;
          fields: { identifier: string; type: string; optional?: boolean }[];
        };
        addEvaluator({
          id: `evaluator_${nanoid()}`,
          evaluatorType: evaluatorType as never,
          inputs: fields as never,
          dbEvaluatorId,
          mappings: {},
          localEvaluatorConfig: { name },
        });
      },
      "workbench.run": async () => {
        // Fire-and-forget: the eval run can take minutes. Apply should
        // confirm immediately; progress is visible in the workbench
        // header.
        void executeEvaluation({ type: "full" });
      },
      "prompts.create": async (payload) => {
        const { handle, messages, model, temperature, maxTokens } =
          payload as {
            handle: string;
            messages: { role: "system" | "user" | "assistant"; content: string }[];
            model?: string;
            temperature?: number;
            maxTokens?: number;
          };
        await createPrompt.mutateAsync({
          projectId,
          data: { handle, messages, model, temperature, maxTokens },
        });
        await utils.prompts.getAllPromptsForProject.invalidate({ projectId });
        return projectSlug
          ? { href: `/${projectSlug}/prompts`, label: "Open prompt" }
          : undefined;
      },
      "prompts.update": async (payload) => {
        const { id, commitMessage, messages, model, temperature, maxTokens } =
          payload as {
            id: string;
            commitMessage: string;
            messages?: { role: "system" | "user" | "assistant"; content: string }[];
            model?: string;
            temperature?: number;
            maxTokens?: number;
          };
        await updatePrompt.mutateAsync({
          projectId,
          id,
          data: {
            commitMessage,
            ...(messages ? { messages } : {}),
            ...(model ? { model } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {}),
          },
        });
        await utils.prompts.getAllPromptsForProject.invalidate({ projectId });
        return projectSlug
          ? { href: `/${projectSlug}/prompts`, label: "Open prompt" }
          : undefined;
      },
      "datasets.create": async (payload) => {
        const { name, columnTypes, initialRows } = payload as {
          name: string;
          columnTypes: { name: string; type: string }[];
          initialRows?: Record<string, unknown>[];
        };
        const created = await upsertDataset.mutateAsync({
          projectId,
          name,
          columnTypes: columnTypes as never,
          ...(initialRows && initialRows.length > 0
            ? {
                datasetRecords: initialRows.map((row) => ({
                  id: nanoid(),
                  entry: row,
                })) as never,
              }
            : {}),
        });
        await utils.dataset.getAll.invalidate({ projectId });
        return projectSlug && created?.id
          ? { href: `/${projectSlug}/datasets/${created.id}`, label: "Open dataset" }
          : undefined;
      },
      "datasets.addRows": async (payload) => {
        const { datasetId, rows } = payload as {
          datasetId: string;
          rows: Record<string, unknown>[];
        };
        await createDatasetRecords.mutateAsync({
          projectId,
          datasetId,
          entries: rows.map((row) => ({ id: nanoid(), ...row })) as never,
        });
        await utils.dataset.getAll.invalidate({ projectId });
        return projectSlug
          ? { href: `/${projectSlug}/datasets/${datasetId}`, label: "Open dataset" }
          : undefined;
      },
    };
  }, [
    project?.id,
    project?.slug,
    createEvaluator,
    updateEvaluator,
    deleteEvaluator,
    createPrompt,
    updatePrompt,
    upsertDataset,
    createDatasetRecords,
    utils,
    addEvaluator,
    removeEvaluator,
    executeEvaluation,
    openDrawer,
  ]);

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

  // Prevent Crisp chat from showing when loading the workbench to not stay on top of the drawer buttons
  useEffect(() => {
    if (typeof window === "undefined" || !("$crisp" in window)) {
      return;
    }

    // @ts-ignore
    window.$crisp.push(["do", "chat:hide"]);

    return () => {
      // @ts-ignore
      window.$crisp.push(["do", "chat:show"]);
    };
  }, []);

  // Show 404 if experiment doesn't exist
  if (!slug || isNotFound) {
    return (
      <DashboardLayout backgroundColor="bg.panel" compactMenu={true}>
        <Box padding={6}>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Experiment not found</Alert.Title>
            <Alert.Description>
              The experiment you&apos;re looking for doesn&apos;t exist or you
              don&apos;t have access to it.
            </Alert.Description>
          </Alert.Root>
        </Box>
      </DashboardLayout>
    );
  }

  // Show error for other failures (permissions, network, etc.)
  if (isError) {
    return (
      <DashboardLayout backgroundColor="bg.panel" compactMenu={true}>
        <Box padding={6}>
          <Alert.Root status="error">
            <Alert.Indicator />
            <Alert.Title>Failed to load experiment</Alert.Title>
            <Alert.Description>
              {error?.message ??
                "An unexpected error occurred while loading the experiment."}
            </Alert.Description>
          </Alert.Root>
        </Box>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout backgroundColor="bg.panel" compactMenu={true}>
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
            <TableSettingsMenu disabled={isLoadingExperiment} />
            <HistoryButton disabled={isLoadingExperiment} />
            <RunEvaluationButton
              disabled={isLoadingExperiment || isLoadingDatasets}
            />
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
          borderColor="border.emphasized"
          bg="bg.panel"
        >
          <Box position="absolute" inset={0} overflow="auto">
            <EvaluationsV3Table
              isLoadingExperiment={isLoadingExperiment}
              isLoadingDatasets={isLoadingDatasets}
            />
          </Box>
        </Box>
      </VStack>

      <SageDrawer
        proposalHandlers={proposalHandlers}
        experimentSlug={slug}
      />

      {/* Load saved dataset records - renders nothing, just triggers fetches */}
      <SavedDatasetLoaders datasets={datasets} />
    </DashboardLayout>
  );
}
