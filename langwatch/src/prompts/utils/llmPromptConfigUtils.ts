import { PromptScope } from "@prisma/client";
import type { Node } from "@xyflow/react";
import type { DeepPartial } from "react-hook-form";

import type { LocalPromptConfig } from "~/evaluations-v3/types";
import type {
  Component,
  LlmConfigParameter,
  LLMConfig,
  LlmPromptConfigComponent,
  NodeDataset,
  Signature,
} from "~/optimization_studio/types/dsl";
import { DEFAULT_MODEL } from "~/utils/constants";
import {
  formSchema,
  handleSchema,
  type PromptConfigFormValues,
} from "~/prompts";
import type { SaveVersionParams } from "~/prompts/providers/types";
import {
  versionMetadataToFormFormat,
  versionMetadataToNodeFormat,
} from "~/prompts/schemas/version-metadata-schema";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { VersionedPrompt } from "~/server/prompt-config";
import {
  type LlmConfigInputType,
  LlmConfigInputTypes,
  type LlmConfigOutputType,
  LlmConfigOutputTypes,
} from "~/types";
import { kebabCase } from "~/utils/stringCasing";

import { generateUniqueIdentifier } from "./identifierUtils";

export function promptConfigFormValuesToOptimizationStudioNodeData(
  formValues: PromptConfigFormValues,
): Node<LlmPromptConfigComponent>["data"] {
  const messages = formValues.version?.configData?.messages ?? [];
  const systemMessage = messages.find((msg) => msg.role === "system");
  const systemPrompt = systemMessage?.content ?? "";
  const messagesWithoutSystem = messages.filter((msg) => msg.role !== "system");

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
        value: systemPrompt,
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: formValues.version?.configData?.demonstrations,
      },
      {
        identifier: "messages",
        type: "chat_messages",
        value: messagesWithoutSystem,
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
        messages: [
          { role: "system", content: parametersMap.instructions?.value ?? "" },
          ...(Array.isArray(parametersMap.messages?.value)
            ? parametersMap.messages.value
            : []),
        ],
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

/**
 * Converts inline node data (parameters array) to LocalPromptConfig format.
 *
 * Used for backward compatibility when old workflow nodes have inline LLM config
 * (parameters array with llm, instructions, messages) but no promptId.
 * This allows the PromptEditorDrawer to display the inline config for editing.
 *
 * Returns undefined if the node has no meaningful inline config (no parameters
 * or empty parameters array).
 *
 * @param nodeData - Raw node data from the workflow (Signature or LlmPromptConfigComponent)
 * @returns LocalPromptConfig if inline config exists, undefined otherwise
 */
export function nodeDataToLocalPromptConfig(
  nodeData: Node<Signature | LlmPromptConfigComponent>["data"],
): LocalPromptConfig | undefined {
  if (!nodeData.parameters || nodeData.parameters.length === 0) {
    return undefined;
  }

  const parametersMap = Object.fromEntries(
    nodeData.parameters.map((p) => [p.identifier, p]),
  );

  const llmParameter = parametersMap.llm as LlmConfigParameter | undefined;
  if (!llmParameter) {
    return undefined;
  }

  // Handle missing or legacy string format for LLM config
  const rawLlmValue = llmParameter.value;
  let llmConfig: LLMConfig;
  if (!rawLlmValue) {
    // LLM parameter exists but has no value (e.g., templates using workflow default_llm).
    // Use DEFAULT_MODEL so we still extract instructions/messages from the node.
    llmConfig = { model: DEFAULT_MODEL };
  } else if (typeof rawLlmValue === "string") {
    console.warn(
      `Migrating legacy LLM format in nodeDataToLocalPromptConfig: string "${rawLlmValue}" -> object`,
    );
    llmConfig = { model: rawLlmValue };
  } else {
    llmConfig = rawLlmValue;
  }

  // Build messages: system message from instructions + other messages
  const instructions = (parametersMap.instructions?.value as string) ?? "";
  const otherMessages = Array.isArray(parametersMap.messages?.value)
    ? (parametersMap.messages.value as Array<{
        role: string;
        content: string;
      }>)
    : [];

  const messages: LocalPromptConfig["messages"] = [
    { role: "system" as const, content: instructions },
    ...otherMessages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  // Map inputs/outputs, defaulting to empty arrays
  const inputs = (nodeData.inputs ?? []).map((i) => ({
    identifier: i.identifier,
    type: i.type as LocalPromptConfig["inputs"][number]["type"],
  }));

  const outputs = (nodeData.outputs ?? []).map((o) => ({
    identifier: o.identifier,
    type: o.type as LocalPromptConfig["outputs"][number]["type"],
    ...(o.json_schema && { json_schema: o.json_schema }),
  }));

  // Build LLM config, omitting undefined fields so they don't override
  // defaults during merge in PromptEditorDrawer (e.g., maxTokens from project)
  const llm: LocalPromptConfig["llm"] = {
    model: llmConfig.model,
    ...(llmConfig.temperature !== undefined && {
      temperature: llmConfig.temperature,
    }),
    ...(llmConfig.max_tokens !== undefined && {
      maxTokens: llmConfig.max_tokens,
    }),
    ...(llmConfig.top_p !== undefined && { topP: llmConfig.top_p }),
    ...(llmConfig.frequency_penalty !== undefined && {
      frequencyPenalty: llmConfig.frequency_penalty,
    }),
    ...(llmConfig.presence_penalty !== undefined && {
      presencePenalty: llmConfig.presence_penalty,
    }),
    ...(llmConfig.seed !== undefined && { seed: llmConfig.seed }),
    ...(llmConfig.top_k !== undefined && { topK: llmConfig.top_k }),
    ...(llmConfig.min_p !== undefined && { minP: llmConfig.min_p }),
    ...(llmConfig.repetition_penalty !== undefined && {
      repetitionPenalty: llmConfig.repetition_penalty,
    }),
    ...(llmConfig.reasoning !== undefined && {
      reasoning: llmConfig.reasoning,
    }),
    ...(llmConfig.verbosity !== undefined && {
      verbosity: llmConfig.verbosity,
    }),
  };

  return {
    llm,
    messages,
    inputs,
    outputs,
  };
}

export function inputsAndOutputsToDemostrationColumns(
  inputs: PromptConfigFormValues["version"]["configData"]["inputs"],
  outputs: PromptConfigFormValues["version"]["configData"]["outputs"],
): { name: string; type: DatasetColumnType; id: string }[] {
  return [
    ...(inputs ?? [])
      .filter(({ type }) => type !== "image")
      .map((input) => ({
        id: input.identifier,
        name: input.identifier,
        type: inputOutputTypeToDatasetColumnType(input.type),
      })),
    ...(outputs ?? []).map((output) => ({
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
    case "list":
      return "list";
    case "chat_messages":
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
  const nodesWithSameName = nodes.filter((node) =>
    node.data.name?.startsWith(kebabCase(workflowName)),
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
          // Traditional sampling parameters
          top_p: prompt.topP,
          frequency_penalty: prompt.frequencyPenalty,
          presence_penalty: prompt.presencePenalty,
          // Other sampling parameters
          seed: prompt.seed,
          top_k: prompt.topK,
          min_p: prompt.minP,
          repetition_penalty: prompt.repetitionPenalty,
          // Reasoning parameter (canonical/unified field)
          reasoning: prompt.reasoning,
          verbosity: prompt.verbosity,
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
    formValues.version.configData.messages?.find((msg) => msg.role === "system")
      ?.content ?? "";
  const messages = formValues.version.configData.messages?.filter(
    (msg) => msg.role !== "system",
  );

  const llm = formValues.version.configData.llm;

  return {
    prompt: systemPrompt,
    messages: messages,
    inputs: formValues.version.configData.inputs,
    outputs: formValues.version.configData.outputs,
    model: llm.model,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    // Traditional sampling parameters
    topP: llm.topP,
    frequencyPenalty: llm.frequencyPenalty,
    presencePenalty: llm.presencePenalty,
    // Other sampling parameters
    seed: llm.seed,
    topK: llm.topK,
    minP: llm.minP,
    repetitionPenalty: llm.repetitionPenalty,
    // Reasoning parameter (canonical/unified field)
    reasoning: llm.reasoning,
    verbosity: llm.verbosity,
    promptingTechnique: formValues.version.configData.promptingTechnique,
    demonstrations: formValues.version.configData.demonstrations,
  };
}

/**
 * Extracts the short handle from a potentially full handle path.
 * Full handles may include scope prefixes that need to be stripped:
 * - project_XXX/ (project prefix)
 * - organization_XXX/ (organization prefix, long form)
 * - XXXXXXXXXXXXXXXXXXXXX/ (21-char nanoid prefix)
 *
 * This strips only the scope prefix, preserving folder structure in handles.
 *
 * Examples:
 * - "project_ABC123/gato" -> "gato"
 * - "organization_ABC123/folder/gato" -> "folder/gato"
 * - "iuc4aYIoL5YcI7imutYvl/gato" -> "gato" (nanoid prefix)
 * - "gato" -> "gato" (no change if no prefix)
 * - "folder/gato" -> "folder/gato" (no change if no scope prefix)
 */
const extractShortHandle = (
  handle: string | null | undefined,
): string | null => {
  if (!handle) return null;

  // Check for known prefixes: project_, org_, organization_
  const knownPrefixMatch = handle.match(/^(?:project_|organization_)[^/]+\//);
  if (knownPrefixMatch) {
    return handle.slice(knownPrefixMatch[0].length);
  }

  // Check for 21-character nanoid prefix (e.g., "iuc4aYIoL5YcI7imutYvl/gato")
  // Nanoids are alphanumeric, 21 chars, followed by /
  const nanoidPrefixMatch = handle.match(/^[a-zA-Z0-9_-]{21}\//);
  if (nanoidPrefixMatch) {
    return handle.slice(nanoidPrefixMatch[0].length);
  }

  // No scope prefix, return as-is
  return handle;
};

/**
 * Converts the versioned prompt to form values without the system message.
 */
export function versionedPromptToPromptConfigFormValues(
  prompt: VersionedPrompt,
): PromptConfigFormValues {
  /**
   * Extract short handle from full path (e.g., "project_ABC/gato" -> "gato")
   * The API may return full paths in some contexts (like version history)
   * but forms should use the short handle.
   */
  const shortHandle = extractShortHandle(prompt.handle);

  /**
   * Because we have old handles that are not valid,
   * we don't include them in the form values so it
   * basically forces them to be a "draft" and then the user
   * must resave the prompt to make it valid.
   */
  const isHandleValid = handleSchema.safeParse(shortHandle).success;

  return formSchema.parse({
    configId: prompt.id,
    versionMetadata: {
      versionId: prompt.versionId,
      versionNumber: prompt.version,
      versionCreatedAt: prompt.versionCreatedAt,
    },
    // Use short handle for form display
    handle: isHandleValid ? shortHandle : null,
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
          // Traditional sampling parameters
          topP: prompt.topP,
          frequencyPenalty: prompt.frequencyPenalty,
          presencePenalty: prompt.presencePenalty,
          // Other sampling parameters
          seed: prompt.seed,
          topK: prompt.topK,
          minP: prompt.minP,
          repetitionPenalty: prompt.repetitionPenalty,
          // Reasoning parameter (canonical/unified field)
          reasoning: prompt.reasoning,
          verbosity: prompt.verbosity,
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
    | "localPromptConfig"
    | "promptId"
    | "promptVersionId"
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
          // Traditional sampling parameters
          top_p: prompt.topP,
          frequency_penalty: prompt.frequencyPenalty,
          presence_penalty: prompt.presencePenalty,
          // Other sampling parameters
          seed: prompt.seed,
          top_k: prompt.topK,
          min_p: prompt.minP,
          repetition_penalty: prompt.repetitionPenalty,
          // Reasoning parameter (canonical/unified field)
          reasoning: prompt.reasoning,
          verbosity: prompt.verbosity,
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
