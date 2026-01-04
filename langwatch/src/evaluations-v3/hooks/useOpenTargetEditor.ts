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

import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import {
  convertToUIMapping,
  convertFromUIMapping,
} from "../utils/fieldMappingConverters";
import {
  datasetColumnTypeToFieldType,
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
} from "~/components/variables";
import type { TargetConfig } from "../types";
import type { Field } from "~/optimization_studio/types/dsl";

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
    }))
  );

  /**
   * Check if a source ID refers to a dataset (vs a target).
   */
  const isDatasetSource = useCallback(
    (sourceId: string) => datasets.some((d) => d.id === sourceId),
    [datasets]
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

        // Set flow callbacks for the prompt editor
        // onLocalConfigChange: persists local changes to the store (for orange dot indicator)
        // onSave: updates target when prompt is published
        // onInputMappingsChange: updates target mappings when variable mappings change (for active dataset)
        // NOTE: No onInputsInitialized here - inputs are already initialized when target was added
        setFlowCallbacks("promptEditor", {
          onLocalConfigChange: (localConfig) => {
            // Only update localPromptConfig for tracking unsaved changes
            updateTarget(target.id, { localPromptConfig: localConfig });
          },
          onSave: (savedPrompt) => {
            updateTarget(target.id, {
              name: savedPrompt.name,
              promptId: savedPrompt.id,
              localPromptConfig: undefined, // Clear local config on save
              // Update inputs/outputs from saved prompt to keep validation working
              inputs: savedPrompt.inputs?.map((i) => ({
                identifier: i.identifier,
                type: i.type as Field["type"],
              })),
              outputs: savedPrompt.outputs?.map((o) => ({
                identifier: o.identifier,
                type: o.type as Field["type"],
              })),
            });
          },
          onInputMappingsChange: (
            identifier: string,
            mapping: UIFieldMapping | undefined
          ) => {
            // Get the current active dataset from store (it may have changed since drawer was opened)
            const currentActiveDatasetId =
              useEvaluationsV3Store.getState().activeDatasetId;
            const currentDatasets = useEvaluationsV3Store.getState().datasets;
            const checkIsDatasetSource = (sourceId: string) =>
              currentDatasets.some((d) => d.id === sourceId);

            if (mapping) {
              setTargetMapping(
                target.id,
                currentActiveDatasetId,
                identifier,
                convertFromUIMapping(mapping, checkIsDatasetSource)
              );
            } else {
              removeTargetMapping(target.id, currentActiveDatasetId, identifier);
            }
          },
        });

        // Open the drawer with initial config and available sources
        const initialLocalConfig = target.localPromptConfig;
        openDrawer("promptEditor", {
          promptId: target.promptId,
          initialLocalConfig,
          availableSources,
          inputMappings: uiMappings,
          urlParams: { targetId: target.id },
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
                mapping: UIFieldMapping | undefined
              ) => {
                const currentActiveDatasetId =
                  useEvaluationsV3Store.getState().activeDatasetId;
                const currentDatasets = useEvaluationsV3Store.getState().datasets;
                const checkIsDatasetSource = (sourceId: string) =>
                  currentDatasets.some((d) => d.id === sourceId);

                if (mapping) {
                  setTargetMapping(
                    target.id,
                    currentActiveDatasetId,
                    identifier,
                    convertFromUIMapping(mapping, checkIsDatasetSource)
                  );
                } else {
                  removeTargetMapping(target.id, currentActiveDatasetId, identifier);
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
    ]
  );

  return { openTargetEditor, buildAvailableSources, isDatasetSource };
};
