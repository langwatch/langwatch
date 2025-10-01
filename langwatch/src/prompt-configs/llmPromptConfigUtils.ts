import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type { DatasetColumnType } from "~/server/datasets/types";
import type { VersionedPrompt } from "~/server/prompt-config";
import {
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

import type { PromptConfigFormValues } from "~/prompt-configs";
import {
  LlmConfigInputTypes,
  LlmConfigOutputTypes,
  type LlmConfigInputType,
  type LlmConfigOutputType,
} from "~/types";
import { kebabCase } from "~/utils/stringCasing";
import { type SaveVersionParams } from "~/prompt-configs/providers/types";
import { isEqual } from "lodash-es";

export function promptConfigFormValuesToOptimizationStudioNodeData(
  formValues: PromptConfigFormValues
): Node<LlmPromptConfigComponent>["data"] {
  return {
    configId: formValues.id,
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
    id: (nodeData as LlmPromptConfigComponent).configId,
    handle: (nodeData as LlmPromptConfigComponent).handle,
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
    handle: llmConfig.handle,
    scope: llmConfig.scope,
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

export function versionedPromptToLlmPromptConfigComponentNodeData(
  prompt: VersionedPrompt
): Node<LlmPromptConfigComponent>["data"] {
  return {
    configId: prompt.id,
    handle: prompt.handle,
    name: prompt.name,
    inputs: prompt.inputs,
    outputs: prompt.outputs,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: {
          model: prompt.model,
          temperature: prompt.temperature,
          max_tokens: prompt.maxTokens,
        },
      },
      {
        identifier: "instructions",
        type: "str",
        value: prompt.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: prompt.demonstrations,
      },
      {
        identifier: "messages",
        type: "chat_messages",
        value: prompt.messages ?? [],
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: prompt.promptingTechnique,
      },
    ],
  };
}

/**
 * Converts the form values to the trigger save version params.
 * It will also filter out the system prompt from the messages array.
 * If both the prompt and system message is set, the prompt will be used.
 * @param formValues
 * @returns
 */
export function formValuesToTriggerSaveVersionParams(
  formValues: PromptConfigFormValues
): Omit<SaveVersionParams, "projectId">['data'] {
  const systemPrompt =
    formValues.version.configData.prompt ??
    formValues.version.configData.messages?.find((msg) => msg.role === "system")
      ?.content;
  const messages = formValues.version.configData.messages?.filter(
    (msg) => msg.role !== "system"
  );

  return {
    handle: formValues.handle,
    scope: formValues.scope,
    prompt: systemPrompt,
    messages: messages,
    inputs: formValues.version.configData.inputs,
    outputs: formValues.version.configData.outputs,
    model: formValues.version.configData.llm.model,
    temperature: formValues.version.configData.llm.temperature,
    maxTokens: formValues.version.configData.llm.max_tokens,
    promptingTechnique: formValues.version.configData.prompting_technique,
    demonstrations: formValues.version.configData.demonstrations
  };
}

export function versionedPromptToPromptConfigFormValues(
  prompt: VersionedPrompt
): PromptConfigFormValues {
  return {
    id: prompt.id,
    handle: prompt.handle,
    scope: prompt.scope,
    version: {
      configData: {
        prompt: prompt.prompt,
        messages: prompt.messages.filter((msg) => msg.role !== "system"),
        inputs: prompt.inputs,
        outputs: prompt.outputs,
        demonstrations: prompt.demonstrations,
        prompting_technique: prompt.promptingTechnique,
        llm: {
          model: prompt.model,
          temperature: prompt.temperature,
          max_tokens: prompt.maxTokens,
        },
      },
    },
  };
}

export function versionedPromptToOptimizationStudioNodeData(
  prompt: VersionedPrompt
): Node<LlmPromptConfigComponent>["data"] {
  return {
    configId: prompt.id,
    handle: prompt.handle,
    name: prompt.name,
    inputs: prompt.inputs,
    outputs: prompt.outputs,
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: {
          model: prompt.model,
          temperature: prompt.temperature,
          max_tokens: prompt.maxTokens,
        },
      },
      {
        identifier: "instructions",
        type: "str",
        value: prompt.prompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: prompt.demonstrations
      },
      {
        identifier: "messages",
        type: "chat_messages",
        value: prompt.messages.filter((msg) => msg.role !== "system"),
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: prompt.promptingTechnique,
      },
    ],
  };
}

/**
 * Converts the node data to a JSON string for comparison.
 * We do not compare all fields, only the ones that are relevant for the prompt.
 * It aggressively standardizes the node data to avoid false drift detection.
 * FIXME: We ignore the demonstrations parameter because it's not required to be created
 * when using the prompt manager, and this creates a false drift detection that 
 * the sync will not resolve. 
 */
function standardizeNodeData(
  nodeData: Node<LlmPromptConfigComponent>["data"]
) {
  return JSON.parse(JSON.stringify({
    handle: nodeData.handle,
    inputs: nodeData.inputs?.map(input => ({
      identifier: input.identifier,
      type: input.type,
    })),
    outputs: nodeData.outputs?.map(output => ({
      identifier: output.identifier,
      type: output.type,
    })),
    parameters: [...nodeData.parameters].filter(param => param.identifier !== "demonstrations").map(param => ({
      identifier: param.identifier,
      type: param.type,
      value: param.value,
    })).sort((a, b) => a.identifier.localeCompare(b.identifier)),
  }));
}

/**
 * Compares two node data objects for equality.
 * Special handling for demonstrations to ignore columnType IDs.
 * @param nodeData1 
 * @param nodeData2 
 * @returns 
 */
export function isNodeDataEqual(
  nodeData1: Node<LlmPromptConfigComponent>["data"],
  nodeData2: Node<LlmPromptConfigComponent>["data"]
): boolean {
  const nodesAreEqual = isEqual(standardizeNodeData(nodeData1), standardizeNodeData(nodeData2));
  return nodesAreEqual;
}
