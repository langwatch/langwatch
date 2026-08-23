import { Alert, Box, HStack, Spacer, VStack } from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useEffect, useMemo } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import {
  WORKBENCH_ACTION_KINDS,
  WORKBENCH_ACTIONS,
} from "~/experiments-v3/actions/manifest";
import { projectWorkbenchState } from "~/experiments-v3/actions/projection";
import { scopeFromRunPayload } from "~/experiments-v3/actions/runScope";
import { AutosaveStatus } from "~/experiments-v3/components/AutosaveStatus";
import { EditableHeading } from "~/experiments-v3/components/EditableHeading";
import { EvaluationsV3Table } from "~/experiments-v3/components/EvaluationsV3Table";
import { HistoryButton } from "~/experiments-v3/components/HistoryButton";
import { RunEvaluationButton } from "~/experiments-v3/components/RunEvaluationButton";
import { SavedDatasetLoaders } from "~/experiments-v3/components/SavedDatasetLoaders";
import { TableSettingsMenu } from "~/experiments-v3/components/TableSettingsMenu";
import { UndoRedo } from "~/experiments-v3/components/UndoRedo";
import { VersionHistoryButton } from "~/experiments-v3/components/VersionHistoryButton";
import { WorkbenchStaleBanner } from "~/experiments-v3/components/WorkbenchStaleBanner";
import { useAutosaveEvaluationsV3 } from "~/experiments-v3/hooks/useAutosaveEvaluationsV3";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import { useExecuteEvaluation } from "~/experiments-v3/hooks/useExecuteEvaluation";
import { useLambdaWarmup } from "~/experiments-v3/hooks/useLambdaWarmup";
import { useOptimizeWithLangy } from "~/experiments-v3/hooks/useOptimizeWithLangy";
import { useSavedDatasetLoader } from "~/experiments-v3/hooks/useSavedDatasetLoader";
import { useWorkbenchUpdateListener } from "~/experiments-v3/hooks/useWorkbenchUpdateListener";
import { HandledErrorAlert } from "~/features/errors";
import type { ProposalHandlers } from "~/features/langy/components/MessageContent";
import {
  useRegisterLangyActions,
  useRegisterLangyHandlers,
} from "~/features/langy/LangyContext";
import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { assertCrispChatHidden } from "~/utils/crispBubblePolicy";

/**
 * The workbench as the agent should read it: the LIVE store, so unsaved prompt
 * drafts, pending cells and in-memory results are included, which the saved
 * copy cannot show. `source` mirrors the backend fallback's marker, so the
 * agent always knows whether it read the live page or the saved document.
 */
function readLiveWorkbench({ includeResults }: { includeResults?: boolean }) {
  const state = useEvaluationsV3Store.getState();

  const identity: { experimentId?: string; experimentSlug?: string } = {};
  if (state.experimentId) identity.experimentId = state.experimentId;
  if (state.experimentSlug) identity.experimentSlug = state.experimentSlug;

  const withResults: { results?: typeof state.results } = {};
  if (includeResults !== false) withResults.results = state.results;

  const projection = projectWorkbenchState({
    state: {
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      targets: state.targets,
      ...identity,
    },
    ...withResults,
  });

  const version: { version?: number } = {};
  if (state.workbenchVersion !== undefined) {
    version.version = state.workbenchVersion;
  }

  return { source: "live", ...version, ...projection };
}

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
  const utils = api.useUtils();
  const { execute: executeEvaluation } = useExecuteEvaluation();
  const { openDrawer } = useDrawer();
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
  const { stale: staleWorkbench, reload: reloadStaleWorkbench } =
    useWorkbenchUpdateListener({
      projectId: project?.id ?? "",
      experimentSlug: typeof slug === "string" ? slug : undefined,
      isDirty,
      reloadFromServer,
    });

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
        const evaluatorType = (
          created?.config as {
            evaluatorType?: string;
          } | null
        )?.evaluatorType;
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
        const { handle, messages, model, temperature, maxTokens } = payload as {
          handle: string;
          messages: {
            role: "system" | "user" | "assistant";
            content: string;
          }[];
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
            messages?: {
              role: "system" | "user" | "assistant";
              content: string;
            }[];
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
          ? {
              href: `/${projectSlug}/datasets/${created.id}`,
              label: "Open dataset",
            }
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
          ? {
              href: `/${projectSlug}/datasets/${datasetId}`,
              label: "Open dataset",
            }
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

  useRegisterLangyHandlers(proposalHandlers, { experimentSlug: slug });

  // The live UI actions this page executes for the agent
  // (specs/langy/langy-ui-actions.feature). Transform-backed kinds run
  // through the store's one shared code path (`applyWorkbenchAction`), so an
  // agent edit and a user edit are the same mutation, one undo entry each.
  // Reads project the LIVE store — unsaved prompt drafts, pending cells and
  // in-memory results included, which the saved copy cannot show.
  const uiActionHandlers = useMemo<LangyUiActionHandlers>(() => {
    const handlers: LangyUiActionHandlers = {};
    for (const kind of WORKBENCH_ACTION_KINDS) {
      const definition = WORKBENCH_ACTIONS[kind];
      if (definition.backend !== "transform") continue;
      handlers[kind] = {
        payloadSchema: definition.payloadSchema,
        // Apply, then persist before answering. The agent reads a successful
        // action as "the document now says this", and its next step is usually
        // a server-side one — a run, a REST read, a version. Left on the 1.5s
        // autosave debounce, the duplicate column existed only in this tab:
        // the run that followed wrote results from the state without it, the
        // broadcast came back with a newer version, and the pending save was
        // then refused as out of date. The column could never be saved after
        // that, so the loop worked on a page nothing else could see.
        run: async (payload: unknown) => {
          const result = useEvaluationsV3Store
            .getState()
            .applyWorkbenchAction({ kind, payload });
          await saveNow();
          return result;
        },
      };
    }
    handlers["workbench.getState"] = {
      payloadSchema: WORKBENCH_ACTIONS["workbench.getState"].payloadSchema,
      run: (payload: { includeResults?: boolean }) =>
        readLiveWorkbench(payload),
    };
    handlers["workbench.run"] = {
      payloadSchema: WORKBENCH_ACTIONS["workbench.run"].payloadSchema,
      run: async (payload: { targetIds?: string[]; rowIndices?: number[] }) => {
        // Persist first: a run writes its results back as a new version, so
        // any edit still sitting in this tab would be a version behind before
        // the first cell lands.
        await saveNow();
        // Fire-and-forget like the run proposal: the run streams into the
        // table the user is watching, and the agent polls the runs API for
        // completion. The payload-to-scope mapping is shared with the backend
        // fallback so both dispatch paths cover the same cells.
        void executeEvaluation(scopeFromRunPayload(payload));
        return { status: "running" as const };
      },
    };
    return handlers;
  }, [executeEvaluation, saveNow]);

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
      <DashboardLayout backgroundColor="bg.panel">
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
      <DashboardLayout backgroundColor="bg.panel">
        <Box padding={6}>
          <HandledErrorAlert
            error={error}
            fallbackTitle="Couldn't load this experiment"
          />
        </Box>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout backgroundColor="bg.panel">
      <VStack
        width="full"
        height="calc(100vh - 50px)"
        gap={0}
        align="stretch"
        overflow="hidden"
      >
        {/* Header */}
        <HStack paddingX={6} paddingTop={5} paddingBottom={3} flexShrink={0}>
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
            <VersionHistoryButton disabled={isLoadingExperiment} />
            <RunEvaluationButton
              disabled={isLoadingExperiment || isLoadingDatasets}
            />
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
    </DashboardLayout>
  );
}
