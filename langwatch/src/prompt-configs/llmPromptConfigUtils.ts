import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type {
  DatasetColumns,
  DatasetColumnType,
} from "~/server/datasets/types";
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
import {
  LlmConfigInputTypes,
  LlmConfigOutputTypes,
  type LlmConfigInputType,
  type LlmConfigOutputType,
} from "~/types";

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

export function safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(
  nodeData: Omit<Node<Signature | LlmPromptConfigComponent>["data"], "configId">
): DeepPartial<PromptConfigFormValues> {
  const parametersMap = nodeData.parameters
    ? Object.fromEntries(nodeData.parameters.map((p) => [p.identifier, p]))
    : {};
  const llmParameter = parametersMap.llm as LlmConfigParameter;
  const inputs = safeInputs(nodeData.inputs);
  const outputs = safeOutputs(nodeData.outputs);
  return {
    name: nodeData.name ?? "",
    version: {
      configData: {
        inputs,
        outputs,
        llm: llmParameter.value,
        prompt:
          typeof parametersMap.instructions?.value === "string"
            ? parametersMap.instructions.value
            : undefined,
        demonstrations: {
          columns: inputsAndOutputsToDemostrationColumns(inputs, outputs),
          rows:
            (
              parametersMap.demonstrations?.value as {
                rows: Record<string, string>[];
              }
            )?.rows ?? [],
        },
      },
    },
  };
}

function safeInputs(
  inputs: Signature["inputs"]
): PromptConfigFormValues["version"]["configData"]["inputs"] {
  return (
    inputs?.map((input) => {
      if (LlmConfigInputTypes.includes(input.type as LlmConfigInputType)) {
        return {
          identifier: input.identifier,
          type: input.type as LlmConfigInputType,
        };
      }
      return {
        identifier: input.identifier,
        type: "str",
      };
    }) ?? []
  );
}

function safeOutputs(
  outputs: Signature["outputs"]
): PromptConfigFormValues["version"]["configData"]["outputs"] {
  return (
    outputs?.map((output) => {
      if (LlmConfigOutputTypes.includes(output.type as LlmConfigOutputType)) {
        return {
          identifier: output.identifier,
          type: output.type as LlmConfigOutputType,
        };
      }
      return {
        identifier: output.identifier,
        type: "str",
      };
    }) ?? []
  );
}

export function inputsAndOutputsToDemostrationColumns(
  inputs: PromptConfigFormValues["version"]["configData"]["inputs"],
  outputs: PromptConfigFormValues["version"]["configData"]["outputs"]
): { name: string; type: DatasetColumnType; id: string }[] {
  return [
    ...inputs
      .filter(({ type }) => type !== "image")
      .map((input) => ({
        id: input.identifier,
        name: input.identifier,
        type: inputOutputTypeToDatasetColumnType(input.type),
      })),
    ...outputs.map((output) => ({
      id: output.identifier,
      name: output.identifier,
      type: inputOutputTypeToDatasetColumnType(output.type),
    })),
  ];
}

function inputOutputTypeToDatasetColumnType(
  type: Omit<LlmConfigInputType | LlmConfigOutputType, "image">
): DatasetColumnType {
  switch (type) {
    case "str":
      return "string";
    case "float":
      return "number";
    case "bool":
      return "boolean";
    case "list[str]":
      return "list";
    case "image":
      throw new Error("Image is not supported in demonstrations");
    default:
      throw new Error(`Unknown input/output type: ${type}`);
  }
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
