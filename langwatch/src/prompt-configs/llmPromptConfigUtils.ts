import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type { DatasetColumnType } from "~/server/datasets/types";
import {
  parseLlmConfigVersion,
  type LatestConfigVersionSchema,
} from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import type {
  Component,
  LlmConfigParameter,
  LlmPromptConfigComponent,
  NodeDataset,
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
      {
        identifier: "messages",
        type: "chat_messages",
        value: version.configData.messages ?? [],
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: version.configData.prompting_technique,
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
      {
        identifier: "messages",
        type: "chat_messages",
        value: formValues.version?.configData?.messages ?? [],
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: formValues.version?.configData?.prompting_technique,
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
  const llmParameter = parametersMap.llm as LlmConfigParameter | undefined;
  const inputs = safeInputs(nodeData.inputs);
  const outputs = safeOutputs(nodeData.outputs);

  return {
    name: nodeData.name ?? "",
    version: {
      configData: {
        inputs,
        outputs,
        llm: llmParameter?.value,
        prompt:
          typeof parametersMap.instructions?.value === "string"
            ? parametersMap.instructions.value
            : undefined,
        messages: Array.isArray(parametersMap.messages?.value)
          ? parametersMap.messages.value
          : [],
        demonstrations: {
          inline: {
            columnTypes: inputsAndOutputsToDemostrationColumns(inputs, outputs),
            records:
              (parametersMap.demonstrations?.value as NodeDataset)?.inline
                ?.records ?? {},
          },
        },
        prompting_technique: parametersMap.prompting_technique
          ?.value as PromptConfigFormValues["version"]["configData"]["prompting_technique"],
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
          ...(output.json_schema && {
            json_schema:
              output.json_schema as PromptConfigFormValues["version"]["configData"]["outputs"][number]["json_schema"],
          }),
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
  type_: LlmConfigInputType | LlmConfigOutputType
): DatasetColumnType {
  switch (type_) {
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
    case "json_schema":
      return "json";
    case "list[float]":
      return "list";
    case "list[int]":
      return "list";
    case "list[bool]":
      return "list";
    case "dict":
      return "json";
    default:
      type_ satisfies never;
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown input/output type: ${type_}`);
  }
}

export function llmConfigToPromptConfigFormValues(
  llmConfig: LlmConfigWithLatestVersion
): PromptConfigFormValues {
  return {
    name: llmConfig.name ?? "",
    referenceId: llmConfig.referenceId ?? "",
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
