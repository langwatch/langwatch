import type { Node } from "@xyflow/react";
import type { LocalPromptConfig } from "~/evaluations-v3/types";
import { buildLLMConfig } from "~/server/prompt-config/llmConfigBuilder";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";
import type {
  Component,
  Evaluator,
  Field,
  LlmPromptConfigComponent,
  Signature,
} from "../types/dsl";

/**
 * Merges unsaved local configs into DSL nodes before sending to the Python executor.
 *
 * For signature nodes with `localPromptConfig`:
 *   - Converts camelCase LLM config to snake_case and replaces the llm parameter
 *   - Extracts system message into instructions, keeps other messages
 *   - Replaces inputs and outputs with local config values
 *
 * For evaluator nodes with `localConfig`:
 *   - Replaces the evaluator name if provided
 *   - Converts settings object into parameters array
 *
 * Nodes without local state pass through unchanged. The local config fields
 * are stripped from the output so they are never sent to the Python backend.
 *
 * This is a pure function; it does not mutate its input.
 */
export function mergeLocalConfigsIntoDsl(
  nodes: Node<Component>[],
): Node<Component>[] {
  return nodes.map((node) => {
    if (node.type === "signature" && hasLocalPromptConfig(node.data)) {
      return mergeSignatureLocalConfig(node);
    }

    if (node.type === "evaluator" && hasLocalConfig(node.data)) {
      return mergeEvaluatorLocalConfig(node);
    }

    return node;
  });
}

// ---------------------------------------------------------------------------
// Signature merge
// ---------------------------------------------------------------------------

function mergeSignatureLocalConfig(
  node: Node<Component>,
): Node<Component> {
  const data = node.data as Signature & { localPromptConfig: LocalPromptConfig };
  const local = data.localPromptConfig;

  const llmConfig = buildLLMConfig({
    model: local.llm.model,
    temperature: local.llm.temperature,
    maxTokens: local.llm.maxTokens,
    topP: local.llm.topP,
    frequencyPenalty: local.llm.frequencyPenalty,
    presencePenalty: local.llm.presencePenalty,
    seed: local.llm.seed,
    topK: local.llm.topK,
    minP: local.llm.minP,
    repetitionPenalty: local.llm.repetitionPenalty,
    reasoning: local.llm.reasoning,
    verbosity: local.llm.verbosity,
    litellmParams: local.llm.litellmParams,
  });

  const systemMessage = local.messages.find((m) => m.role === "system");
  const nonSystemMessages = local.messages.filter((m) => m.role !== "system");

  const parameters: LlmPromptConfigComponent["parameters"] = [
    { identifier: "llm", type: "llm", value: llmConfig },
    { identifier: "instructions", type: "str", value: systemMessage?.content ?? "" },
    {
      identifier: "messages",
      type: "chat_messages",
      value: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    },
  ];

  const mergedData: LlmPromptConfigComponent = {
    ...data,
    inputs: local.inputs.map((input) => ({
      identifier: input.identifier,
      type: input.type as LlmConfigInputType,
    })),
    outputs: local.outputs.map((output) => ({
      identifier: output.identifier,
      type: output.type as LlmConfigOutputType,
      ...(output.json_schema ? { json_schema: output.json_schema } : {}),
    })),
    parameters,
    localPromptConfig: undefined,
  };

  return { ...node, data: mergedData };
}

// ---------------------------------------------------------------------------
// Evaluator merge
// ---------------------------------------------------------------------------

function mergeEvaluatorLocalConfig(
  node: Node<Component>,
): Node<Component> {
  const data = node.data as Evaluator & {
    localConfig: NonNullable<Evaluator["localConfig"]>;
  };
  const local = data.localConfig;

  const parameters: Field[] = Object.entries(local.settings ?? {}).map(
    ([key, value]) => ({
      identifier: key,
      type: "str" as const,
      value,
    }),
  );

  const mergedData: Evaluator = {
    ...data,
    name: local.name ?? data.name,
    parameters,
    localConfig: undefined,
  };

  return { ...node, data: mergedData };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function hasLocalPromptConfig(
  data: Component,
): data is Signature & { localPromptConfig: LocalPromptConfig } {
  return (
    "localPromptConfig" in data &&
    (data as Signature).localPromptConfig !== undefined &&
    (data as Signature).localPromptConfig !== null
  );
}

function hasLocalConfig(
  data: Component,
): data is Evaluator & { localConfig: NonNullable<Evaluator["localConfig"]> } {
  return (
    "localConfig" in data &&
    (data as Evaluator).localConfig !== undefined &&
    (data as Evaluator).localConfig !== null
  );
}
