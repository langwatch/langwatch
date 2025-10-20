import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type {
  Component,
  LlmConfigParameter,
  LlmPromptConfigComponent,
  NodeDataset,
  Signature,
} from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { type SaveVersionParams } from "~/prompt-configs/providers/types";
import {
  versionMetadataToFormFormat,
  versionMetadataToNodeFormat,
} from "~/prompt-configs/schemas/version-metadata-schema";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { VersionedPrompt } from "~/server/prompt-config";
import { type LatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";
import {
  LlmConfigInputTypes,
  LlmConfigOutputTypes,
  type LlmConfigInputType,
  type LlmConfigOutputType,
} from "~/types";
import { kebabCase } from "~/utils/stringCasing";

export function promptConfigFormValuesToOptimizationStudioNodeData(
  formValues: PromptConfigFormValues,
): Node<LlmPromptConfigComponent>["data"] {
  return {
    configId: formValues.configId,
    handle: formValues.handle,
    versionMetadata: versionMetadataToNodeFormat(formValues.versionMetadata),
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
        value: formValues.version?.configData?.promptingTechnique,
      },
    ],
  };
}

export function safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(
  nodeData: Node<Signature | LlmPromptConfigComponent>["data"],
): DeepPartial<PromptConfigFormValues> {
  const parametersMap = nodeData.parameters
    ? Object.fromEntries(nodeData.parameters.map((p) => [p.identifier, p]))
    : {};
  const llmParameter = parametersMap.llm as LlmConfigParameter | undefined;
  const inputs = safeInputs(nodeData.inputs);
  const outputs = safeOutputs(nodeData.outputs);
  const llmNode = nodeData as LlmPromptConfigComponent;

  return {
    configId: llmNode.configId,
    versionMetadata: versionMetadataToFormFormat(llmNode.versionMetadata),
    handle: llmNode.handle,
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
        promptingTechnique: parametersMap.prompting_technique
          ?.value as PromptConfigFormValues["version"]["configData"]["promptingTechnique"],
        responseFormat: parametersMap.response_format
          ?.value as PromptConfigFormValues["version"]["configData"]["responseFormat"],
      },
    },
  };
}

function safeInputs(
  inputs: Signature["inputs"],
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
  outputs: Signature["outputs"],
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
  outputs: PromptConfigFormValues["version"]["configData"]["outputs"],
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
  type_: LlmConfigInputType | LlmConfigOutputType,
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

export function createNewOptimizationStudioPromptName(
  workflowName: string,
  nodes: Node<Component>[],
) {
  const nodesWithSameName = nodes.filter(
    (node) => node.data.name?.startsWith(kebabCase(workflowName)),
  ).length;

  const promptName = kebabCase(
    `${workflowName}-new-prompt-${nodesWithSameName + 1}`,
  );

  return promptName;
}

export function versionedPromptToLlmPromptConfigComponentNodeData(
  prompt: VersionedPrompt,
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
  formValues: PromptConfigFormValues,
): Omit<Omit<SaveVersionParams, "projectId">["data"], "commitMessage"> {
  const systemPrompt =
    formValues.version.configData.prompt ??
    formValues.version.configData.messages?.find((msg) => msg.role === "system")
      ?.content;
  const messages = formValues.version.configData.messages?.filter(
    (msg) => msg.role !== "system",
  );

  return {
    prompt: systemPrompt,
    messages: messages,
    inputs: formValues.version.configData.inputs,
    outputs: formValues.version.configData.outputs,
    model: formValues.version.configData.llm.model,
    temperature: formValues.version.configData.llm.temperature,
    maxTokens: formValues.version.configData.llm.maxTokens,
    promptingTechnique: formValues.version.configData.promptingTechnique,
    demonstrations: formValues.version.configData.demonstrations,
    responseFormat: formValues.version.configData.responseFormat,
  };
}

export function versionedPromptToPromptConfigFormValues(
  prompt: VersionedPrompt,
): PromptConfigFormValues {
  return {
    configId: prompt.id,
    versionMetadata: {
      versionId: prompt.versionId,
      versionNumber: prompt.version,
      versionCreatedAt: prompt.versionCreatedAt,
    },
    handle: prompt.handle,
    scope: prompt.scope,
    version: {
      configData: {
        prompt: prompt.prompt,
        // The system message should be stored in the prompt field in the DB,
        // so this shouldn't be necessary, but it's a precaution.
        messages: prompt.messages.filter((msg) => msg.role !== "system"),
        inputs: prompt.inputs,
        outputs: prompt.outputs,
        demonstrations: prompt.demonstrations,
        promptingTechnique: prompt.promptingTechnique,
        responseFormat: prompt.responseFormat,
        llm: {
          model: prompt.model,
          temperature: prompt.temperature,
          maxTokens: prompt.maxTokens,
        },
      },
    },
  };
}

export function versionedPromptToPromptConfigFormValuesWithSystemMessage(
  prompt: VersionedPrompt,
): PromptConfigFormValues {
  const base = versionedPromptToPromptConfigFormValues(prompt);

  base.version.configData.messages = [
    { role: "system", content: prompt.prompt },
    ...base.version.configData.messages,
  ];

  return base;
}

export function versionedPromptToOptimizationStudioNodeData(
  prompt: VersionedPrompt,
): Required<
  Omit<
    LlmPromptConfigComponent,
    | "_library_ref"
    | "cls"
    | "isCustom"
    | "behave_as"
    | "execution_state"
    | "id"
    | "description"
  >
> {
  return {
    configId: prompt.id,
    handle: prompt.handle,
    name: prompt.handle ?? prompt.name,
    versionMetadata: versionMetadataToNodeFormat({
      versionId: prompt.versionId,
      versionNumber: prompt.version,
      versionCreatedAt: prompt.versionCreatedAt,
    })!,
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

export { isNodeDataEqual } from "./nodeDataComparison";
