import { Button, Spinner, Text } from "@chakra-ui/react";
import { FlaskConical } from "lucide-react";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import {
  createInitialState,
  type DatasetReference,
} from "~/evaluations-v3/types";
import { extractPersistedState } from "~/evaluations-v3/types/persistence";
import { inferAllTargetMappings } from "~/evaluations-v3/utils/mappingInference";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { areFormValuesEqual } from "~/prompts/utils/areFormValuesEqual";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import { api } from "~/utils/api";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import type { TabData } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import type { LocalPromptConfig, TargetConfig } from "~/evaluations-v3/types";
import type { Field } from "~/optimization_studio/types/dsl";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

/**
 * Converts a playground tab's form values to a LocalPromptConfig.
 * Used when a prompt has unsaved changes or is brand new.
 */
const convertToLocalPromptConfig = (
  tabData: TabData,
): LocalPromptConfig | undefined => {
  const configData = tabData.form.currentValues.version?.configData;
  if (!configData) return undefined;

  const llm = configData.llm;
  const messages = configData.messages ?? [];
  const inputs = configData.inputs ?? [];
  const outputs = configData.outputs ?? [];

  // Filter out undefined entries from litellmParams
  const filteredLitellmParams = llm?.litellmParams
    ? Object.fromEntries(
        Object.entries(llm.litellmParams).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      )
    : undefined;

  return {
    llm: {
      model: llm?.model ?? "openai/gpt-4o",
      temperature: llm?.temperature ?? undefined,
      maxTokens: llm?.maxTokens ?? undefined,
      litellmParams: filteredLitellmParams,
    },
    messages: messages
      .filter((m): m is NonNullable<typeof m> => m !== undefined)
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content ?? "",
      })),
    inputs: inputs
      .filter((i): i is NonNullable<typeof i> => i !== undefined)
      .map((i) => ({
        identifier: i.identifier ?? "input",
        type: (i.type ?? "str") as LocalPromptConfig["inputs"][number]["type"],
      })),
    outputs: outputs
      .filter((o): o is NonNullable<typeof o> => o !== undefined)
      .map((o) => ({
        identifier: o.identifier ?? "output",
        type: (o.type ?? "str") as LocalPromptConfig["outputs"][number]["type"],
        json_schema: o.json_schema ?? undefined,
      })),
  };
};

/**
 * Check if a tab has unsaved changes compared to its saved version.
 * Uses the same comparison logic as the prompt playground (areFormValuesEqual).
 *
 * @param tabData - The current tab data
 * @param savedPrompt - The saved prompt from the database (if available)
 * @returns true if there are unsaved changes, false if form matches saved version
 */
const hasUnsavedChanges = (
  tabData: TabData,
  savedPrompt: VersionedPrompt | null | undefined,
): boolean => {
  const configId = tabData.form.currentValues.configId;
  const currentValues = tabData.form.currentValues;

  // Never been saved - has unsaved changes
  if (!configId) return true;

  // No handle - has unsaved changes
  if (!currentValues.handle) return true;

  // No saved prompt found - has unsaved changes
  if (!savedPrompt) return true;

  // No current values - no changes (defensive)
  if (!currentValues) return false;

  // Use the same comparison logic as useHasUnsavedChanges hook
  // This ensures consistency with the drawer behavior
  const savedValues = computeInitialFormValuesForPrompt({
    prompt: savedPrompt,
    useSystemMessage: true,
  });

  return !areFormValuesEqual(savedValues, currentValues);
};

/**
 * Converts a playground tab to a TargetConfig for the experiment.
 *
 * Logic for localPromptConfig:
 * - If prompt is NEW (no configId): always include localPromptConfig
 * - If prompt is SAVED but HAS LOCAL CHANGES: include localPromptConfig with current values
 * - If prompt is SAVED with NO CHANGES: reference by ID only (no localPromptConfig)
 *
 * @param tabData - The current tab data
 * @param index - Index for generating unique target ID
 * @param datasets - Datasets for auto-mapping
 * @param savedPrompt - The saved prompt from database (for comparison)
 */
const convertTabToTarget = (
  tabData: TabData,
  index: number,
  datasets: DatasetReference[],
  savedPrompt: VersionedPrompt | null | undefined,
): TargetConfig => {
  const configId = tabData.form.currentValues.configId;
  const versionId = tabData.form.currentValues.versionMetadata?.versionId;

  const configData = tabData.form.currentValues.version?.configData;
  const inputs: Field[] = (configData?.inputs ?? [])
    .filter((i): i is NonNullable<typeof i> => i !== undefined)
    .map((i) => ({
      identifier: i.identifier ?? "input",
      type: (i.type ?? "str") as Field["type"],
    }));
  const outputs: Field[] = (configData?.outputs ?? [])
    .filter((o): o is NonNullable<typeof o> => o !== undefined)
    .map((o) => ({
      identifier: o.identifier ?? "output",
      type: (o.type ?? "str") as Field["type"],
    }));

  // Determine if we need localPromptConfig
  const hasChanges = hasUnsavedChanges(tabData, savedPrompt);

  // Create target with initial empty mappings
  const targetId = `target_${Date.now()}_${index}`;
  const targetWithoutMappings: TargetConfig = {
    id: targetId,
    type: "prompt",
    // Always reference the saved prompt if it exists (for version tracking)
    promptId: configId ?? undefined,
    promptVersionId: versionId ?? undefined,
    promptVersionNumber: configId ? tabData.meta.versionNumber : undefined,
    // Only include localPromptConfig if there are unsaved changes
    localPromptConfig: hasChanges
      ? convertToLocalPromptConfig(tabData)
      : undefined,
    inputs,
    outputs,
    mappings: {},
  };

  // Apply auto-mapping for target inputs
  const autoMappings = inferAllTargetMappings(targetWithoutMappings, datasets);

  return {
    ...targetWithoutMappings,
    mappings: autoMappings,
  };
};

interface ExperimentFromPlaygroundButtonProps {
  iconOnly?: boolean;
}

/**
 * Button to create an experiment from the current prompt playground tabs.
 * Opens a confirmation dialog and creates the experiment with all open prompts as targets.
 *
 * Single Responsibility: Handles the "Create Experiment from Playground" flow.
 */
export function ExperimentFromPlaygroundButton({
  iconOnly,
}: ExperimentFromPlaygroundButtonProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const utils = api.useContext();

  // Get all tabs from all windows
  const { isComparing, allTabs, activeTab } = useDraggableTabsBrowserStore((state) => {
    const activeWindow = state.windows.find(
      (w) => w.id === state.activeWindowId,
    );
    return {
      isComparing: state.windows.length > 1,
      allTabs: state.windows.flatMap((w) => w.tabs),
      activeTab: activeWindow?.tabs.find(
        (t) => t.id === activeWindow?.activeTabId,
      ),
    };
  });

  const promptCount = allTabs.length;
  const isDisabled = promptCount === 0 || !hasPermission("evaluations:manage");

  // Extract unique saved prompt IDs to fetch
  const savedPromptIds = useMemo(() => {
    return allTabs
      .map((tab) => tab.data.form.currentValues.configId)
      .filter((id): id is string => !!id);
  }, [allTabs]);

  // Fetch saved prompts to compare against current form values
  // This allows us to detect if there are unsaved changes
  const savedPromptsQueries = api.useQueries((t) =>
    savedPromptIds.map((configId) => {
      const tab = allTabs.find(
        (tab) => tab.data.form.currentValues.configId === configId,
      );
      const versionId = tab?.data.form.currentValues.versionMetadata?.versionId;

      return t.prompts.getByIdOrHandle(
        {
          idOrHandle: configId,
          projectId: project?.id ?? "",
          versionId: versionId,
        },
        {
          enabled: !!project?.id && isDialogOpen,
          // Keep stale data to avoid flickering
          staleTime: 60_000,
        },
      );
    }),
  );

  // Check if all queries are loading
  const isLoadingSavedPrompts = savedPromptsQueries.some((q) => q.isLoading);

  // Create a map of configId -> savedPrompt for quick lookup
  const savedPromptsMap = useMemo(() => {
    const map = new Map<string, VersionedPrompt | null>();
    savedPromptIds.forEach((configId, index) => {
      const query = savedPromptsQueries[index];
      // Only set if query has completed (data exists or is explicitly null after fetch)
      if (!query?.isLoading) {
        map.set(configId, query?.data ?? null);
      }
    });
    return map;
  }, [savedPromptIds, savedPromptsQueries]);

  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      void utils.experiments.getAllForEvaluationsList.invalidate();
      void router.push(`/${project?.slug}/experiments/workbench/${data.slug}`);
      setIsCreating(false);
      setIsDialogOpen(false);
    },
    onError: () => {
      setIsCreating(false);
    },
  });

  const handleCreate = () => {
    if (!project?.id || isCreating || isLoadingSavedPrompts) return;

    setIsCreating(true);

    // Generate human-readable name for the experiment
    const experimentName = generateHumanReadableId();

    // Create initial state with the generated name
    const initialState = createInitialState();
    initialState.name = experimentName;

    // Convert all tabs to targets with auto-mapping
    const targets = (isComparing ? allTabs : [activeTab]).map((tab, index) => {
      const configId = tab.data.form.currentValues.configId;
      const savedPrompt = configId ? savedPromptsMap.get(configId) : null;
      return convertTabToTarget(
        tab.data,
        index,
        initialState.datasets,
        savedPrompt,
      );
    });
    initialState.targets = targets;

    // Extract persisted state for saving
    const persistedState = extractPersistedState(initialState);

    createExperiment.mutate({
      projectId: project.id,
      experimentId: undefined,
      state: {
        ...persistedState,
        experimentSlug: experimentName,
      } as Parameters<typeof createExperiment.mutate>[0]["state"],
    });
  };

  return (
    <>
      <Tooltip content="Experiment" disabled={!iconOnly}>
        <PageLayout.HeaderButton
          onClick={() => setIsDialogOpen(true)}
          disabled={isDisabled}
          title={
            isDisabled ? "Open a prompt to create an experiment" : undefined
          }
        >
          <FlaskConical size="18px" />
          {!iconOnly && "Experiment"}
        </PageLayout.HeaderButton>
      </Tooltip>

      <Dialog.Root
        open={isDialogOpen}
        onOpenChange={({ open }) => setIsDialogOpen(open)}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Create Experiment</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>
              {!isComparing || promptCount === 1
                ? "Create new experiment with this prompt?"
                : `Create new experiment with these prompts? (${promptCount} prompts)`}
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button
              variant="ghost"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleCreate}
              disabled={isCreating || isLoadingSavedPrompts}
            >
              {(isCreating || isLoadingSavedPrompts) && (
                <Spinner size="sm" marginRight={2} />
              )}
              {isLoadingSavedPrompts ? "Loading..." : "Create"}
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
