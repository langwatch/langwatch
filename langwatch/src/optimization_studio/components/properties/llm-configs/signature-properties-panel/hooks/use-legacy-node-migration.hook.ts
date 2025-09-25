import { type Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef } from "react";

import type { LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { setDefaultLlmConfigToParameters } from "../utils/set-default-llm-config-to-parameters";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import { useWorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type {
  LlmPromptConfigComponent,
  Signature,
} from "~/optimization_studio/types/dsl";
import { usePromptConfig } from "~/prompt-configs/hooks/usePromptConfig";
import { type PromptConfigFormValues } from "~/prompt-configs";
import {
  createNewOptimizationStudioPromptName,
  llmConfigToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { snakeCase } from "~/utils/stringCasing";

const logger = createLogger(
  "langwatch:optimization-studio:signature-properties-panel"
);

/**
 * Custom hook to handle legacy node migration from old format to new prompt config format
 * 
 * This hook manages the complex process of migrating legacy optimization studio nodes
 * that don't have a configId to the new prompt configuration system. It handles:
 * - Creating new prompt configs with proper handles
 * - Converting node data to form values
 * - Creating new versions with migrated data
 * - Updating the node with the new configuration
 * 
 * @param node - The optimization studio node to potentially migrate
 * @param options - Configuration options including skip flag to bypass migration
 */
export function useLegacyNodeMigration(
  node: Node<Signature | LlmPromptConfigComponent>,
  options: { skip: boolean }
) {
  const { project } = useOrganizationTeamProject();
  const createMutation =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();
  const setNode = useSmartSetNode();
  
  // Extract workflow state needed for migration
  const {
    name: workflowName,
    nodes,
    defaultLLMConfig,
  } = useWorkflowStore((state) => ({
    name: state.getWorkflow().name,
    nodes: state.getWorkflow().nodes,
    defaultLLMConfig: state.getWorkflow().default_llm,
  }));
  
  // Check if node already has a configId (not a legacy node)
  const nodeHasConfigId = "configId" in node.data;
  
  // Track processed node IDs to prevent duplicate migrations
  const idRef = useRef<string | null>(null);
  
  const { createNewVersion } = usePromptConfig();

  /**
   * Migrate the legacy node to the new prompt config format
   * 
   * This function performs the complete migration process:
   * 1. Generates a unique name and handle for the new config
   * 2. Creates a new prompt config in the database
   * 3. Converts legacy node data to the new format
   * 4. Creates a new version with the converted data
   * 5. Updates the node with the new configuration data
   */
  const migrateLegacyNode = useCallback(async () => {
    try {
      // Generate a name for the new config, using existing name or creating one
      const tempName =
        (node.data as LlmPromptConfigComponent).name ??
        createNewOptimizationStudioPromptName(workflowName, nodes);

      // Create a unique handle for the config (snake_case with random suffix)
      const handle = snakeCase(tempName + "-" + nanoid(5));
      node.data.name = tempName;

      // Create the new prompt config in the database
      const newConfig = await createMutation.mutateAsync({
        handle,
        projectId: project?.id ?? "",
      });

      // Convert legacy node data to form initial values format
      const initialValues =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues({
          ...node.data,
          parameters: setDefaultLlmConfigToParameters(
            (node.data.parameters ??
              []) as LlmPromptConfigComponent["parameters"],
            defaultLLMConfig
          ),
        });

      // Extract config data from both the new config and the converted node data
      const currentConfigData = newConfig.latestVersion.configData;
      const nodeConfigData = initialValues.version?.configData;
      const { llm, ...rest } =
        nodeConfigData ??
        ({} as PromptConfigFormValues["version"]["configData"]);

      // Create a new version with the migrated data, preserving existing values where available
      const newVersion = await createNewVersion(
        newConfig.id,
        {
          prompt: rest?.prompt ?? "",
          inputs: rest?.inputs ?? currentConfigData.inputs,
          outputs: rest?.outputs ?? currentConfigData.outputs,
          messages: rest?.messages ?? currentConfigData.messages,
          model: llm?.model ?? currentConfigData.model,
          temperature: llm?.temperature ?? currentConfigData.temperature,
          max_tokens: llm?.max_tokens ?? currentConfigData.max_tokens,
          demonstrations:
            rest?.demonstrations ?? currentConfigData.demonstrations,
          prompting_technique:
            rest?.prompting_technique ?? currentConfigData.prompting_technique,
        } as LatestConfigVersionSchema["configData"],
        "Save from legacy node"
      );

      // Convert the new config back to optimization studio node data format
      const newNodeData = llmConfigToOptimizationStudioNodeData({
        ...newConfig,
        latestVersion: newVersion as unknown as LatestConfigVersionSchema,
      });

      // Update the node with the new configuration data
      setNode({
        ...node,
        data: newNodeData,
      });
    } catch (error) {
      logger.error({ error }, "Failed to migrate legacy node");
      toaster.error({
        title: "Failed to migrate legacy node",
        description:
          "Please contact support if this issue persists. This should not happen.",
      });
    }
  }, [
    node,
    project,
    createMutation,
    createNewVersion,
    workflowName,
    nodes,
    setNode,
    defaultLLMConfig,
  ]);

  /**
   * Effect to automatically migrate legacy nodes when conditions are met
   * 
   * Migration occurs when:
   * - Migration is not skipped via options
   * - Project ID is available
   * - Node doesn't already have a configId (is legacy)
   * - Node hasn't already been processed (tracked by idRef)
   * 
   * The effect runs once per node ID to prevent duplicate migrations.
   */
  useEffect(() => {
    // Skip migration if explicitly disabled, no project, or node already has configId
    if (options.skip || !project?.id || nodeHasConfigId) return;
    
    // Prevent duplicate migrations for the same node
    if (idRef.current === node.id) return;

    // Perform the migration asynchronously
    void migrateLegacyNode();
    
    // Mark this node as processed
    idRef.current = node.id;
  }, [
    options.skip,
    project?.id,
    node,
    nodeHasConfigId,
    workflowName,
    nodes,
    migrateLegacyNode,
  ]);
}
