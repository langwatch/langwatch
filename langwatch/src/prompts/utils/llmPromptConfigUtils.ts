import { PromptScope } from "@prisma/client";
import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type {
  Component,
  LlmConfigParameter,
  LlmPromptConfigComponent,
  NodeDataset,
  Signature,
} from "~/optimization_studio/types/dsl";
import { formSchema, type PromptConfigFormValues } from "~/prompts";
import { type SaveVersionParams } from "~/prompts/providers/types";
import {
  versionMetadataToFormFormat,
  versionMetadataToNodeFormat,
} from "~/prompts/schemas/version-metadata-schema";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { VersionedPrompt } from "~/server/prompt-config";
import {
  LlmConfigInputTypes,
  LlmConfigOutputTypes,
  type LlmConfigInputType,
  type LlmConfigOutputType,
} from "~/types";
import { kebabCase } from "~/utils/stringCasing";

import { generateUniqueIdentifier } from "./identifierUtils";

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

/**
 * Safely converts node data to form initial values, handling legacy formats and corrupted data.
 *
 * Auto-generates or provides defaults for missing or invalid data:
 * - Identifiers: Auto-generated for inputs/outputs via safeInputs/safeOutputs
 * - Handle: Defaults to null if missing
 * - Scope: Defaults to PROJECT if missing (required by schema)
 * - LLM config: Migrates legacy string format (model name) to object { model }
 * - LLM config: Provides empty object if missing (schema applies defaults)
 * - Prompt: Defaults to empty string if missing
 *
 * @param nodeData - Raw node data from the workflow
 * @returns Partial form values with safe defaults for all required fields
 */
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

  // Safely extract LLM config, handling legacy format where LLM was just a model string
  // Legacy format: llm = "openai/gpt-4-0125-preview"
  // New format: llm = { model: "openai/gpt-4-0125-preview", temperature: 0.7, maxTokens: 1000 }
  const rawLlmValue = llmParameter?.value;
  let llmValue: DeepPartial<
    PromptConfigFormValues["version"]["configData"]["llm"]
  >;

  if (rawLlmValue && typeof rawLlmValue === "string") {
    // Migrate legacy format: string model name → object with model field
    console.warn(
      `Migrating legacy LLM format: string "${String(
        rawLlmValue,
      )}" → object with model field`,
    );
    llmValue = { model: rawLlmValue };
  } else if (rawLlmValue && typeof rawLlmValue === "object") {
    llmValue = rawLlmValue;
  } else {
    llmValue = {};
  }

  // Extract scope safely - it may not exist on all node types
  let scope: PromptScope | undefined = undefined;
  if ("scope" in llmNode && typeof llmNode.scope === "string") {
    scope = llmNode.scope as PromptScope;
  }

  return {
    configId: llmNode.configId,
    versionMetadata: versionMetadataToFormFormat(llmNode.versionMetadata),
    handle: llmNode.handle ?? null,
    scope: scope ?? PromptScope.PROJECT,
    version: {
      configData: {
        inputs,
        outputs,
        llm: llmValue,
        prompt:
          typeof parametersMap.instructions?.value === "string"
            ? parametersMap.instructions.value
            : "",
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

/**
 * Safely converts node inputs to form values, auto-generating identifiers for corrupted data.
 *
 * If an input has an empty or missing identifier, generates a unique one automatically
 * instead of throwing a validation error.
 *
 * @param inputs - Raw input data from the node
 * @returns Validated inputs with guaranteed identifiers
 */
function safeInputs(
  inputs: Signature["inputs"],
): PromptConfigFormValues["version"]["configData"]["inputs"] {
  const existingIdentifiers: string[] = [];

  return (
    inputs?.map((input) => {
      let identifier = input.identifier?.trim();

      // Auto-generate identifier if missing or empty
      if (!identifier) {
        identifier = generateUniqueIdentifier({
          baseName: "input",
          existingIdentifiers,
        });
        console.warn(
          `Auto-generated identifier "${identifier}" for corrupted input`,
        );
      }

      existingIdentifiers.push(identifier);

      if (LlmConfigInputTypes.includes(input.type as LlmConfigInputType)) {
        return {
          identifier,
          type: input.type as LlmConfigInputType,
        };
      }
      return {
        identifier,
        type: "str",
      };
    }) ?? []
  );
}

/**
 * Safely converts node outputs to form values, auto-generating identifiers for corrupted data.
 *
 * If an output has an empty or missing identifier, generates a unique one automatically
 * instead of throwing a validation error.
 *
 * @param outputs - Raw output data from the node
 * @returns Validated outputs with guaranteed identifiers
 */
function safeOutputs(
  outputs: Signature["outputs"],
): PromptConfigFormValues["version"]["configData"]["outputs"] {
  const existingIdentifiers: string[] = [];

  return (
    outputs?.map((output) => {
      let identifier = output.identifier?.trim();

      // Auto-generate identifier if missing or empty
      if (!identifier) {
        identifier = generateUniqueIdentifier({
          baseName: "output",
          existingIdentifiers,
        });
        console.warn(
          `Auto-generated identifier "${identifier}" for corrupted output`,
        );
      }

      existingIdentifiers.push(identifier);

      if (LlmConfigOutputTypes.includes(output.type as LlmConfigOutputType)) {
        return {
          identifier,
          type: output.type as LlmConfigOutputType,
          ...(output.json_schema && {
            json_schema:
              output.json_schema as PromptConfigFormValues["version"]["configData"]["outputs"][number]["json_schema"],
          }),
        };
      }
      return {
        identifier,
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

/**
 * Converts the versioned prompt to form values without the system message.
 */
export function versionedPromptToPromptConfigFormValues(
  prompt: VersionedPrompt,
): PromptConfigFormValues {
  return formSchema.parse({
    configId: prompt.id,
    versionMetadata: {
      versionId: prompt.versionId,
      versionNumber: prompt.version,
      versionCreatedAt: prompt.versionCreatedAt,
    },
    handle: prompt.handle || null,
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
  });
}

/**
 * Converts the versioned prompt to form values with the system message.
 * The system message is added to the messages array.
 */
export function versionedPromptToPromptConfigFormValuesWithSystemMessage(
  prompt: VersionedPrompt,
): PromptConfigFormValues {
  const base = versionedPromptToPromptConfigFormValues(prompt);

  if (prompt.prompt) {
    base.version.configData.messages = [
      { role: "system", content: prompt.prompt },
      ...base.version.configData.messages,
    ];
  }

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
