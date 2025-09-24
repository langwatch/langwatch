import { Spinner } from "@chakra-ui/react";
import { type Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { useEffect, useRef } from "react";

import type { LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { useWizardContext } from "../../../../../components/evaluations/wizard/hooks/useWizardContext";
import { useWorkflowStore } from "../../../../hooks/useWorkflowStore";
import type {
  LlmPromptConfigComponent,
  Signature,
} from "../../../../types/dsl";
import { BasePropertiesPanel } from "../../BasePropertiesPanel";

import { SignaturePropertiesPanelInner } from "./SignaturePropertiesPanelInner";
import { setDefaultLlmConfigToParameters } from "./utils/set-default-llm-config-to-parameters";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSmartSetNode } from "~/optimization_studio/hooks/useSmartSetNode";
import { usePromptConfig } from "~/prompt-configs/hooks/usePromptConfig";
import {
  type PromptConfigFormValues,
} from "~/prompt-configs/hooks/usePromptConfigForm";
import {
  createNewOptimizationStudioPromptName,
  llmConfigToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
} from "~/prompt-configs/llmPromptConfigUtils";
import { PromptConfigProvider } from "~/prompt-configs/providers/PromptConfigProvider";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { snakeCase } from "~/utils/stringCasing";

const logger = createLogger(
  "langwatch:optimization-studio:signature-properties-panel"
);


/**
 * Wrapper component that provides the PromptConfigProvider context
 * to the inner panel component
 */
export function SignaturePropertiesPanel({
  node,
}: {
  node: Node<Signature | LlmPromptConfigComponent>;
}) {
  const { project } = useOrganizationTeamProject();
  const createMutation =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();
  const setNode = useSmartSetNode();
  const {
    name: workflowName,
    nodes,
    defaultLLMConfig,
  } = useWorkflowStore((state) => ({
    name: state.getWorkflow().name,
    nodes: state.getWorkflow().nodes,
    defaultLLMConfig: state.getWorkflow().default_llm,
  }));
  const nodeHasConfigId = "configId" in node.data;
  const idRef = useRef<string | null>(null);
  const { createNewVersion } = usePromptConfig();

  // For backwards compatibility, we need to check if there's a configId on the node data.
  // If not, we need to create a new config and update the node data.
  useEffect(() => {
    if (!project?.id) return;
    // If the node id is the same as the idRef, we've already checked this node
    if (idRef.current === node.id) return;
    // If the node has a configId, we don't need to create a new config
    if (!nodeHasConfigId) {
      void (async () => {
        try {
          // Create a temporary name for the config
          const tempName =
            (node.data as LlmPromptConfigComponent).name ??
            createNewOptimizationStudioPromptName(workflowName, nodes);

          // Convert the name to the handle standard and make it unique
          const handle = snakeCase(tempName + "-" + nanoid(5));

          // Reset the node name
          node.data.name = tempName;

          // Create a new config
          const newConfig = await createMutation.mutateAsync({
            handle,
            projectId: project?.id ?? "",
          });

          // Convert the node data to form initial values
          const initialValues =
            safeOptimizationStudioNodeDataToPromptConfigFormInitialValues({
              ...node.data,
              parameters: setDefaultLlmConfigToParameters(
                (node.data.parameters ??
                  []) as LlmPromptConfigComponent["parameters"],
                defaultLLMConfig
              ),
            });

          // Use the initial values to create a new version
          const currentConfigData = newConfig.latestVersion.configData; // Use the defaults
          const nodeConfigData = initialValues.version?.configData; // Use the node's config data
          const { llm, ...rest } =
            nodeConfigData ??
            ({} as PromptConfigFormValues["version"]["configData"]);

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
                rest?.prompting_technique ??
                currentConfigData.prompting_technique,
            } as LatestConfigVersionSchema["configData"],
            "Save from legacy node"
          );

          // Convert the new config and version to node data
          const newNodeData = llmConfigToOptimizationStudioNodeData({
            ...newConfig,
            latestVersion: newVersion as unknown as LatestConfigVersionSchema,
          });

          // Update the node data with the new config and version
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
      })();
      // Set the idRef to the node id to prevent duplicate calls
      idRef.current = node.id;
    }
  }, [
    project?.id,
    createMutation,
    node,
    workflowName,
    nodes,
    setNode,
    nodeHasConfigId,
    createNewVersion,
    defaultLLMConfig,
  ]);

  const { isInsideWizard } = useWizardContext();

  if (!nodeHasConfigId) {
    return (
      <BasePropertiesPanel
        node={node}
        hideParameters
        hideInputs
        hideOutputs
        {...(isInsideWizard && {
          hideHeader: true,
          width: "full",
          maxWidth: "full",
        })}
      >
        <Spinner />
      </BasePropertiesPanel>
    );
  }

  return (
    <PromptConfigProvider>
      <SignaturePropertiesPanelInner
        node={node as Node<LlmPromptConfigComponent>}
      />
    </PromptConfigProvider>
  );
}
