/**
 * Hook to open the target editor drawer with proper flow callbacks.
 *
 * This centralizes the logic for:
 * 1. Building available sources for variable mapping
 * 2. Converting mappings to UI format
 * 3. Setting up flow callbacks (onLocalConfigChange, onSave, onInputMappingsChange)
 * 4. Opening the drawer
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
import type { TargetConfig } from "../types";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../utils/fieldMappingConverters";
import { createPromptEditorCallbacks } from "../utils/promptEditorCallbacks";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

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

        // Convert target mappings for the active dataset to UI format
        const datasetMappings = target.mappings[activeDatasetId] ?? {};
        const uiMappings: Record<string, UIFieldMapping> = {};
        for (const [key, mapping] of Object.entries(datasetMappings)) {
          uiMappings[key] = convertToUIMapping(mapping);
        }

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
          } else {
            // Code agent - open code editor drawer
            // Build available sources for variable mapping (active dataset only)
            const availableSources = buildAvailableSources();

            // Convert target mappings for the active dataset to UI format
            const datasetMappings = target.mappings[activeDatasetId] ?? {};
            const uiMappings: Record<string, UIFieldMapping> = {};
            for (const [key, mapping] of Object.entries(datasetMappings)) {
              uiMappings[key] = convertToUIMapping(mapping);
            }

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
