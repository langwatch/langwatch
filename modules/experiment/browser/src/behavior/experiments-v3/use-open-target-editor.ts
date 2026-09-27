/**
 * Hook to open the target editor drawer with proper flow callbacks.
 */

import { setFlowCallbacks, useDrawer } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { toComparisonConfig } from "@langwatch/experiment-contract";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
} from "@langwatch/prompt-browser-kit";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { DRAWER_WIDTH } from "../../model/experiments-v3/constants.ts";
import { createEvaluatorEditorCallbacks } from "../../model/experiments-v3/evaluator-editor-callbacks.ts";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../../model/experiments-v3/field-mapping-converters.ts";
import { createPromptEditorCallbacks } from "../../model/experiments-v3/prompt-editor-callbacks.ts";
import type {
  ComparisonEvaluatorConfig,
  DatasetReference,
  FieldMapping,
  TargetConfig,
} from "../../model/experiments-v3/types.ts";
import {
  COMPARISON_EVALUATOR_TYPE,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
} from "../../model/experiments-v3/types.ts";
import { buildTargetAvailableSources } from "./target-available-sources.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";
import { useResolveTargetName } from "./use-resolve-target-name.ts";

/**
 * Convert target mappings for a specific dataset to UI format.
 * This is used when opening drawers to populate the input mappings.
 */
export const buildUIMappings = (
  target: TargetConfig,
  activeDatasetId: string,
): Record<string, UIFieldMapping> => {
  const datasetMappings = target.mappings[activeDatasetId] ?? {};
  const uiMappings: Record<string, UIFieldMapping> = {};
  for (const [key, mapping] of Object.entries(datasetMappings)) {
    uiMappings[key] = convertToUIMapping(mapping as FieldMapping);
  }
  return uiMappings;
};

/**
 * Scroll the table container to position the target column right next to the drawer edge.
 * Uses smooth scrolling animation for a polished UX.
 */
export const scrollToTargetColumn = (targetId: string) => {
  // Find the target column header by data attribute
  const targetHeader = document.querySelector(`[data-target-column="${targetId}"]`);
  if (!targetHeader) return;

  // Find the scrollable container by traversing up to find scrollable element
  let container = targetHeader.parentElement;
  while (container && container !== document.body) {
    const style = window.getComputedStyle(container);
    if (style.overflow === "auto" || style.overflowX === "auto") {
      break;
    }
    container = container.parentElement;
  }

  if (!container || container === document.body) return;

  // Get positions
  const headerRect = targetHeader.getBoundingClientRect();

  // Calculate where the right edge of the column should be
  // We want: column right edge = viewport width - drawer width
  const viewportWidth = window.innerWidth;
  const targetRightEdge = viewportWidth - DRAWER_WIDTH;

  // Current position of column's right edge relative to viewport
  const currentRightEdge = headerRect.right;

  // How much we need to scroll
  // If column is to the right of target position, scroll right (positive)
  // If column is to the left of target position, scroll left (negative)
  const scrollDelta = currentRightEdge - targetRightEdge;

  // Apply the scroll with smooth animation
  container.scrollBy({
    left: scrollDelta,
    behavior: "smooth",
  });
};

/**
 * The drawer an agent target edits in. A workflow agent points at a Studio graph
 * (no inline code); a connected agent is registered from the customer's own code
 * (nothing to edit, only its declared inputs); http and code agents edit here.
 */
const agentEditorDrawerFor = (
  agentType: string | undefined,
): "agentWorkflowTargetEditor" | "agentConnectedDetail" | "agentHttpEditor" | "agentCodeEditor" => {
  if (agentType === "workflow") return "agentWorkflowTargetEditor";
  if (agentType === "connected") return "agentConnectedDetail";
  if (agentType === "http") return "agentHttpEditor";
  return "agentCodeEditor";
};

/**
 * A target input's mapping edits, written to the dataset active when the drawer
 * opened: these drawers are not modal, so the reader may switch datasets meanwhile.
 */
const targetMappingChangeHandler =
  ({
    targetId,
    datasetId,
    isDatasetSource,
  }: {
    targetId: string;
    datasetId: string;
    isDatasetSource: (sourceId: string) => boolean;
  }) =>
  (identifier: string, mapping: UIFieldMapping | undefined): void => {
    const store = useEvaluationsV3Store.getState();
    if (!mapping) {
      store.removeTargetMapping(targetId, datasetId, identifier);
      return;
    }
    store.setTargetMapping({
      targetId,
      datasetId,
      inputField: identifier,
      mapping: convertFromUIMapping(mapping, isDatasetSource),
    });
  };

/**
 * The evaluator drawer's props for a comparison column-target: the comparison form
 * (variants and golden field) in place of per-row mappings. A legacy pairwise
 * target keeps its own evaluatorType so the drawer loads that row's settings.
 */
const comparisonEditorProps = ({
  target,
  targetComparison,
  datasets,
  activeDatasetId,
  targets,
}: {
  target: TargetConfig & { targetEvaluatorId?: string };
  targetComparison: ComparisonEvaluatorConfig;
  datasets: DatasetReference[];
  activeDatasetId: string;
  targets: TargetConfig[];
}) => {
  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  return {
    evaluatorId: target.targetEvaluatorId,
    evaluatorType: target.comparison ? COMPARISON_EVALUATOR_TYPE : LEGACY_PAIRWISE_EVALUATOR_TYPE,
    initialLocalConfig: target.localEvaluatorConfig,
    comparisonContext: {
      initialComparison: targetComparison,
      targets: targets.filter((t) => t.type !== "evaluator" && t.id !== target.id),
      datasetColumns: activeDataset?.columns.map((c) => ({ id: c.id, name: c.name })) ?? [],
      datasetName: activeDataset?.name,
    },
    urlParams: { targetId: target.id },
  };
};

export const useOpenTargetEditor = () => {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useUtils();
  const resolveTargetName = useResolveTargetName();

  const {
    datasets,
    activeDatasetId,
    targets,
    updateTarget,
    updateTargetComparison,
    setTargetMapping,
    removeTargetMapping,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      targets: state.targets,
      updateTarget: state.updateTarget,
      updateTargetComparison: state.updateTargetComparison,
      setTargetMapping: state.setTargetMapping,
      removeTargetMapping: state.removeTargetMapping,
    })),
  );

  /**
   * Check if a source ID refers to a dataset (vs a target).
   */
  const isDatasetSource = useCallback(
    (sourceId: string) => datasets.some((d) => d.id === sourceId),
    [datasets],
  );

  /**
   * The sources a target's variables can map onto: the active dataset, and the
   * other targets whose outputs this one can chain from, each labelled with the
   * name a reader knows it by.
   */
  const buildAvailableSources = useCallback(
    (editedTargetId?: string): AvailableSource[] =>
      buildTargetAvailableSources({
        activeDataset: datasets.find((d) => d.id === activeDatasetId),
        otherTargets: targets.filter((candidate) => candidate.id !== editedTargetId),
        resolveTargetName,
      }),
    [datasets, activeDatasetId, targets, resolveTargetName],
  );

  /**
   * Open the target editor drawer with proper flow callbacks.
   */
  const openTargetEditor = useCallback(
    async (target: TargetConfig) => {
      if (target.type === "prompt") {
        // Build available sources for variable mapping (active dataset only)
        const availableSources = buildAvailableSources(target.id);
        const uiMappings = buildUIMappings(target, activeDatasetId);

        // Set flow callbacks for the prompt editor using the centralized helper
        // This ensures we never forget a required callback
        setFlowCallbacks(
          "promptEditor",
          createPromptEditorCallbacks({
            targetId: target.id,
            updateTarget,
            setTargetMapping,
            removeTargetMapping,
            getActiveDatasetId: () => useEvaluationsV3Store.getState().activeDatasetId,
            getDatasets: () => useEvaluationsV3Store.getState().datasets,
          }),
        );

        // Open the drawer with initial config and available sources
        const initialLocalConfig = target.localPromptConfig;
        openDrawer(
          "promptEditor",
          {
            promptId: target.promptId,
            // If there are local changes or a pinned version, use that version ID
            // so the drawer shows the correct base version
            promptVersionId: target.promptVersionId,
            initialLocalConfig,
            availableSources,
            inputMappings: uiMappings,
            urlParams: { targetId: target.id },
          },
          // Reset stack to prevent back button when switching between targets
          { resetStack: true },
        );

        // Scroll to position the target column next to the drawer
        // Use requestAnimationFrame to ensure the drawer has started opening
        requestAnimationFrame(() => {
          scrollToTargetColumn(target.id);
        });
      } else if (target.type === "agent" && target.dbAgentId) {
        try {
          const agent = await trpcUtils.agents.getById.fetch({
            projectId: project?.id ?? "",
            id: target.dbAgentId,
          });
          const drawer = agentEditorDrawerFor(agent?.type);
          setFlowCallbacks(drawer, {
            onInputMappingsChange: targetMappingChangeHandler({
              targetId: target.id,
              datasetId: activeDatasetId,
              isDatasetSource,
            }),
          });
          openDrawer(drawer, {
            availableSources: buildAvailableSources(target.id),
            inputMappings: buildUIMappings(target, activeDatasetId),
            urlParams: { targetId: target.id, agentId: target.dbAgentId ?? "" },
          });
          requestAnimationFrame(() => scrollToTargetColumn(target.id));
        } catch (error) {
          console.error("Failed to fetch agent:", error);
        }
      } else if (target.type === "evaluator" && target.targetEvaluatorId) {
        // Pairwise column-target (#5100): when the target carries a `pairwise` config,
        // render the clean ComparisonConfigForm (Variant A / Variant B / Golden)
        // instead of the per-row mappings UI.
        const targetComparison = toComparisonConfig(target);
        if (targetComparison) {
          setFlowCallbacks(
            "evaluatorEditor",
            createEvaluatorEditorCallbacks({
              targetId: target.id,
              updateTarget,
              onComparisonChange: (next) => {
                updateTargetComparison(target.id, next);
              },
            }),
          );

          openDrawer(
            "evaluatorEditor",
            comparisonEditorProps({ target, targetComparison, datasets, activeDatasetId, targets }),
          );

          requestAnimationFrame(() => {
            scrollToTargetColumn(target.id);
          });
          return;
        }

        // Evaluator target - open evaluator editor drawer with mappings config
        const availableSources = buildAvailableSources(target.id);
        const uiMappings = buildUIMappings(target, activeDatasetId);

        const handleMappingChange = targetMappingChangeHandler({
          targetId: target.id,
          datasetId: activeDatasetId,
          isDatasetSource,
        });

        // Set flow callbacks for the evaluator editor using the centralized helper.
        // onMappingChange is registered here (durable) instead of inside mappingsConfig
        // (ephemeral complexProps) so it survives in-app drawer navigation and
        // ErrorBoundary remounts (not hard browser reloads — those clear all state).
        setFlowCallbacks(
          "evaluatorEditor",
          createEvaluatorEditorCallbacks({
            targetId: target.id,
            updateTarget,
            onMappingChange: handleMappingChange,
          }),
        );

        // Build mappings config without onMappingChange — callback is durable via flowCallbacks
        const mappingsConfig = {
          availableSources,
          initialMappings: uiMappings,
        };

        // Pass initialLocalConfig from target state so drawer resumes unsaved changes
        const initialLocalConfig = target.localEvaluatorConfig;

        openDrawer("evaluatorEditor", {
          evaluatorId: target.targetEvaluatorId,
          mappingsConfig,
          initialLocalConfig,
          urlParams: { targetId: target.id },
        });

        // Scroll to position the target column next to the drawer
        requestAnimationFrame(() => {
          scrollToTargetColumn(target.id);
        });
      }
    },
    [
      buildAvailableSources,
      activeDatasetId,
      datasets,
      targets,
      updateTarget,
      updateTargetComparison,
      setTargetMapping,
      removeTargetMapping,
      openDrawer,
      trpcUtils.agents.getById,
      project?.id,
      isDatasetSource,
    ],
  );

  return { openTargetEditor, buildAvailableSources, isDatasetSource };
};
