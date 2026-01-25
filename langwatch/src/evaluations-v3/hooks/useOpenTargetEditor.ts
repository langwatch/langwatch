/**
 * Hook to open the target editor drawer with proper flow callbacks.
 *
 * This centralizes the logic for:
 * 1. Building available sources for variable mapping
 * 2. Converting mappings to UI format
 * 3. Setting up flow callbacks (onLocalConfigChange, onSave, onInputMappingsChange)
 * 4. Opening the drawer
 * 5. Auto-scrolling to make the target column visible next to the drawer
 *
 * Used by both EvaluationsV3Table (header click) and RunEvaluationButton (validation).
 */

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type AvailableSource,
  datasetColumnTypeToFieldType,
  type FieldMapping as UIFieldMapping,
} from "~/components/variables";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DRAWER_WIDTH } from "../constants";
import type { FieldMapping, TargetConfig } from "../types";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../utils/fieldMappingConverters";
import { createPromptEditorCallbacks } from "../utils/promptEditorCallbacks";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

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
  const targetHeader = document.querySelector(
    `[data-target-column="${targetId}"]`,
  );
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

export const useOpenTargetEditor = () => {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();

  const {
    datasets,
    activeDatasetId,
    updateTarget,
    setTargetMapping,
    removeTargetMapping,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      updateTarget: state.updateTarget,
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
   * Build available sources for variable mapping (active dataset only).
   */
  const buildAvailableSources = useCallback((): AvailableSource[] => {
    const activeDataset = datasets.find((d) => d.id === activeDatasetId);
    if (!activeDataset) return [];

    return [
      {
        id: activeDataset.id,
        name: activeDataset.name,
        type: "dataset" as const,
        fields: activeDataset.columns.map((col) => ({
          name: col.name,
          type: datasetColumnTypeToFieldType(col.type),
        })),
      },
    ];
  }, [datasets, activeDatasetId]);

  /**
   * Open the target editor drawer with proper flow callbacks.
   */
  const openTargetEditor = useCallback(
    async (target: TargetConfig) => {
      if (target.type === "prompt") {
        // Build available sources for variable mapping (active dataset only)
        const availableSources = buildAvailableSources();
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
            getActiveDatasetId: () =>
              useEvaluationsV3Store.getState().activeDatasetId,
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
        // Fetch the agent to determine its type
        try {
          const agent = await trpcUtils.agents.getById.fetch({
            projectId: project?.id ?? "",
            id: target.dbAgentId,
          });

          if (agent?.type === "workflow") {
            // Open workflow in new tab
            const config = agent.config as Record<string, unknown>;
            const workflowId = config.workflowId as string | undefined;
            if (workflowId) {
              const workflowUrl = `/${project?.slug}/studio/${workflowId}`;
              window.open(workflowUrl, "_blank");
            }
          } else if (agent?.type === "http") {
            // HTTP agent - open HTTP editor drawer
            const availableSources = buildAvailableSources();
            const uiMappings = buildUIMappings(target, activeDatasetId);

            // Set flow callbacks for the HTTP editor
            setFlowCallbacks("agentHttpEditor", {
              onInputMappingsChange: (
                identifier: string,
                mapping: UIFieldMapping | undefined,
              ) => {
                const currentActiveDatasetId =
                  useEvaluationsV3Store.getState().activeDatasetId;
                const currentDatasets =
                  useEvaluationsV3Store.getState().datasets;
                const checkIsDatasetSource = (sourceId: string) =>
                  currentDatasets.some((d) => d.id === sourceId);

                if (mapping) {
                  setTargetMapping(
                    target.id,
                    currentActiveDatasetId,
                    identifier,
                    convertFromUIMapping(mapping, checkIsDatasetSource),
                  );
                } else {
                  removeTargetMapping(
                    target.id,
                    currentActiveDatasetId,
                    identifier,
                  );
                }
              },
            });

            openDrawer("agentHttpEditor", {
              availableSources,
              inputMappings: uiMappings,
              urlParams: {
                targetId: target.id,
                agentId: target.dbAgentId ?? "",
              },
            });

            // Scroll to position the target column next to the drawer
            requestAnimationFrame(() => {
              scrollToTargetColumn(target.id);
            });
          } else {
            // Code agent - open code editor drawer
            const availableSources = buildAvailableSources();
            const uiMappings = buildUIMappings(target, activeDatasetId);

            // Set flow callbacks for the code editor
            setFlowCallbacks("agentCodeEditor", {
              onInputMappingsChange: (
                identifier: string,
                mapping: UIFieldMapping | undefined,
              ) => {
                const currentActiveDatasetId =
                  useEvaluationsV3Store.getState().activeDatasetId;
                const currentDatasets =
                  useEvaluationsV3Store.getState().datasets;
                const checkIsDatasetSource = (sourceId: string) =>
                  currentDatasets.some((d) => d.id === sourceId);

                if (mapping) {
                  setTargetMapping(
                    target.id,
                    currentActiveDatasetId,
                    identifier,
                    convertFromUIMapping(mapping, checkIsDatasetSource),
                  );
                } else {
                  removeTargetMapping(
                    target.id,
                    currentActiveDatasetId,
                    identifier,
                  );
                }
              },
            });

            openDrawer("agentCodeEditor", {
              availableSources,
              inputMappings: uiMappings,
              urlParams: {
                targetId: target.id,
                agentId: target.dbAgentId ?? "",
              },
            });

            // Scroll to position the target column next to the drawer
            requestAnimationFrame(() => {
              scrollToTargetColumn(target.id);
            });
          }
        } catch (error) {
          console.error("Failed to fetch agent:", error);
        }
      }
    },
    [
      buildAvailableSources,
      activeDatasetId,
      updateTarget,
      setTargetMapping,
      removeTargetMapping,
      openDrawer,
      trpcUtils.agents.getById,
      project?.id,
      project?.slug,
    ],
  );

  return { openTargetEditor, buildAvailableSources, isDatasetSource };
};
