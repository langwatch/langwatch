import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type { DatasetColumns } from "~/server/datasets/types";
import {
  parseLlmConfigVersion,
  type LatestConfigVersionSchema,
} from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import type {
  Component,
  LlmConfigParameter,
  LlmPromptConfigComponent,
  Signature,
} from "../optimization_studio/types/dsl";

import type { PromptConfigFormValues } from "~/prompt-configs/hooks/usePromptConfigForm";
import { kebabCase } from "~/utils/stringCasing";

export function llmConfigToOptimizationStudioNodeData(
  config: LlmConfigWithLatestVersion
): Node<LlmPromptConfigComponent>["data"] {
  const { latestVersion } = config;
  const version = parseLlmConfigVersion(latestVersion);

  return {
    // We need this to be able to update the config
    configId: config.id,
    name: config.name,
    inputs: version.configData.inputs,
    outputs: version.configData.outputs,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: {
          model: version.configData.model,
        },
      },
      {
        identifier: "instructions",
        type: "str",
        value: version.configData.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: version.configData.demonstrations,
      },
    ],
  };
}

export function promptConfigFormValuesToOptimizationStudioNodeData(
  configId: string,
  formValues: PromptConfigFormValues
): Node<LlmPromptConfigComponent>["data"] {
  return {
    configId,
    name: formValues.name,
    inputs: formValues.version?.configData?.inputs,
    outputs: formValues.version?.configData?.outputs,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: formValues.version?.configData?.llm,
      },
      {
        identifier: "instructions",
        type: "str",
        value: formValues.version?.configData?.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: formValues.version?.configData?.demonstrations,
      },
    ],
  };
}

export function optimizationStudioNodeDataToPromptConfigFormInitialValues(
  nodeData: Omit<Node<Signature | LlmPromptConfigComponent>["data"], "configId">
): DeepPartial<PromptConfigFormValues> {
  const parametersMap = nodeData.parameters
    ? Object.fromEntries(nodeData.parameters.map((p) => [p.identifier, p]))
    : {};
  const llmParameter = parametersMap.llm as LlmConfigParameter;
  return {
    name: nodeData.name ?? "",
    version: {
      configData: {
        inputs: nodeData.inputs ?? [],
        outputs: nodeData.outputs ?? [],
        llm: llmParameter.value,
        prompt:
          typeof parametersMap.instructions?.value === "string"
            ? parametersMap.instructions.value
            : undefined,
        demonstrations:
          typeof parametersMap.demonstrations?.value === "object" &&
          parametersMap.demonstrations?.value !== null
            ? (parametersMap.demonstrations.value as {
                columns: DatasetColumns;
                rows: Record<string, string>[];
              })
            : undefined,
      },
    },
  };
}

export function llmConfigToPromptConfigFormValues(
  llmConfig: LlmConfigWithLatestVersion
): PromptConfigFormValues {
  return {
    name: llmConfig.name ?? "",
    version: {
      configData: {
        ...llmConfig.latestVersion.configData,
        llm: {
          model: llmConfig.latestVersion.configData.model,
          temperature: llmConfig.latestVersion.configData.temperature,
          max_tokens: llmConfig.latestVersion.configData.max_tokens,
        },
      },
    },
  };
}

export function promptConfigFormValuesVersionToLlmConfigVersionConfigData(
  versionValues: PromptConfigFormValues["version"]
): LatestConfigVersionSchema["configData"] {
  return {
    ...versionValues.configData,
    model: versionValues.configData.llm.model,
    temperature: versionValues.configData.llm.temperature,
    max_tokens: versionValues.configData.llm.max_tokens,
  };
}

export function createNewOptimizationStudioPromptName(
  workflowName: string,
  nodes: Node<Component>[]
) {
  const nodesWithSameName = nodes.filter(
    (node) => node.data.name?.startsWith(kebabCase(workflowName))
  ).length;

  const promptName = kebabCase(
    `${workflowName}-new-prompt-${nodesWithSameName + 1}`
  );

  return promptName;
}
