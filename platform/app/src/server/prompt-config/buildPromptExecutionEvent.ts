/**
 * Builds the workflow event that runs a prompt from the playground.
 *
 * Lifted verbatim out of the CopilotKit `PromptStudioAdapter` when that runtime
 * was removed. Everything here is pure — form values in, `execute_component`
 * event out — so the transport around it can change without touching the part
 * that has actually been through production.
 *
 * And it has. The `{{input}}` binding below carries three separate fixes, each
 * of which shipped as a user-visible regression first; the comments name them
 * because the next person to "simplify" this will otherwise reintroduce one.
 */
import { nanoid } from "nanoid";
import {
  LATEST_SPEC_VERSION,
  type LlmPromptConfigComponent,
  type Workflow,
} from "~/optimization_studio/types/dsl";
import type { StudioClientEvent } from "~/optimization_studio/types/events";
import { LlmSignatureNodeFactory } from "~/optimization_studio/utils/llmSignatureNodeFactory";
import { versionMetadataToNodeFormat } from "~/prompts/schemas/version-metadata-schema";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { ChatMessage } from "~/server/tracer/types";
import { buildLLMConfig } from "./llmConfigBuilder";

/** Matches a `{{ input }}` Liquid placeholder (whitespace tolerated). */
const TEMPLATE_INPUT_PLACEHOLDER_RE = /\{\{\s*input\s*\}\}/;

/** The node id the playground executes. The stream keys its deltas off it. */
export const PROMPT_NODE_ID = "prompt_node";

export interface PromptRuntimeVariable {
  identifier: string;
  value?: unknown;
}

/** A conversation turn as the playground holds it. */
export interface PromptChatTurn {
  role: string;
  content: string;
}

/**
 * Resolves the conversation history and the input bindings for one run.
 *
 * Exported separately from the event so the heuristics can be tested without
 * building a workflow around them.
 */
export function resolvePromptInputs({
  formValues,
  messages,
  variables,
}: {
  formValues: PromptConfigFormValues;
  messages: PromptChatTurn[];
  variables: PromptRuntimeVariable[];
}): { messagesHistory: ChatMessage[]; inputs: Record<string, unknown> } {
  const formMsgs = (formValues.version.configData.messages ?? []).filter(
    (m) => m.role !== "system",
  );

  const lastLiveUserMsg = [...messages]
    .reverse()
    .find((m) => m.role === "user");

  // The absorb check spans ANY template message, system included. The narrower
  // "user templates only" version duplicated the live turn whenever `{{input}}`
  // sat in the system message and the user template was a fixed instruction
  // like "answer it" (2026-05-17, follow-up to #4087).
  const allTemplateMsgs = formValues.version.configData.messages ?? [];
  const templateReferencesInput = allTemplateMsgs.some((m) =>
    TEMPLATE_INPUT_PLACEHOLDER_RE.test(m.content ?? ""),
  );

  // Drop the latest live turn from the history when a template will absorb it
  // through `{{input}}`, or the user reads their own message twice. Earlier
  // turns still belong in the history.
  const liveMessagesForHistory =
    templateReferencesInput && lastLiveUserMsg
      ? messages.filter((m) => m !== lastLiveUserMsg)
      : messages;

  // Order matters. When the template absorbs the latest turn, its
  // `{{input}}`-bearing slot must land LAST so it represents the newest turn.
  // Putting the template first shipped `{{input}}` at index 1 with the real
  // history behind it, so the model saw the latest question as if it had been
  // asked before everything else (prod regression on long histories).
  const messagesHistory = (
    templateReferencesInput && lastLiveUserMsg
      ? [...liveMessagesForHistory, ...formMsgs]
      : [...formMsgs, ...liveMessagesForHistory]
  )
    .map((message) => ({ role: message.role, content: message.content }))
    .filter((message) => message.role !== "system") as ChatMessage[];

  const inputs = (variables ?? []).reduce<Record<string, unknown>>((acc, v) => {
    if (v.value !== undefined) acc[v.identifier] = v.value;
    return acc;
  }, {});

  // Falsy check, not `=== undefined`: a saved prompt declares `input` in its
  // inputs list, so the form always carries an `input` key, defaulting to "".
  // A strict-undefined check left it empty, `{{input}}` rendered to nothing,
  // AND the absorb step above dropped the live turn — the 2026-05-17 prod
  // regression. Treating empty as "not set" keeps the user's intent: an
  // explicit value from the Variables panel still wins.
  const lastLiveUserContent =
    typeof lastLiveUserMsg?.content === "string"
      ? lastLiveUserMsg.content
      : undefined;
  if (lastLiveUserContent !== undefined && !inputs.input) {
    inputs.input = lastLiveUserContent;
  }

  return { messagesHistory, inputs };
}

/**
 * Builds the node the playground executes.
 *
 * Prompt-span parity: when the form came from a saved prompt, its identity
 * fields ride along so nlpgo emits the `PromptApiService.get` + `Prompt.compile`
 * span pair with the full identity, and the trace drawer's "Open in Prompts"
 * link resolves back to the playground. Ad-hoc prompts omit the keys, matching
 * the python-sdk's "Create new prompt" path.
 */
function buildNodeData({
  formValues,
  messagesHistory,
}: {
  formValues: PromptConfigFormValues;
  messagesHistory: ChatMessage[];
}): LlmPromptConfigComponent {
  const messages = formValues.version.configData.messages ?? [];
  const systemPrompt =
    messages.find((msg) => msg.role === "system")?.content ?? "";

  return {
    name: "LLM Node",
    description: "LLM calling node",
    ...(formValues.configId !== undefined && { configId: formValues.configId }),
    ...(formValues.handle !== undefined && { handle: formValues.handle }),
    ...(formValues.versionMetadata !== undefined && {
      versionMetadata: versionMetadataToNodeFormat(formValues.versionMetadata),
    }),
    parameters: [
      {
        identifier: "llm",
        type: "llm",
        value: buildLLMConfig(formValues.version.configData.llm),
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: formValues.version.configData.promptingTechnique ?? undefined,
      },
      { identifier: "instructions", type: "str", value: systemPrompt },
      {
        identifier: "messages",
        type: "chat_messages",
        value: messagesHistory.filter((m) => m.role !== "system"),
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: formValues.version.configData.demonstrations ?? undefined,
      },
    ],
    inputs: formValues.version.configData.inputs,
    outputs: formValues.version.configData.outputs,
  };
}

function buildWorkflow({
  workflowId,
  formValues,
  messagesHistory,
}: {
  workflowId: string;
  formValues: PromptConfigFormValues;
  messagesHistory: ChatMessage[];
}): Workflow {
  return {
    spec_version: LATEST_SPEC_VERSION,
    workflow_id: workflowId,
    name: "Prompt Execution",
    icon: "",
    description: "",
    version: "1.0",
    template_adapter: "default",
    enable_tracing: true,
    nodes: [
      {
        ...LlmSignatureNodeFactory.build({
          id: PROMPT_NODE_ID,
          data: buildNodeData({ formValues, messagesHistory }),
        }),
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    state: { execution: { status: "idle" } },
  };
}

/**
 * Builds the `execute_component` event for one playground run.
 *
 * The caller supplies the trace id so the same id can be used for the message
 * the reply streams into — the conversation's "View trace" affordance then
 * points at the run that produced it (#853).
 */
export function buildPromptExecutionEvent({
  formValues,
  messages,
  variables,
  traceId,
  threadId,
}: {
  formValues: PromptConfigFormValues;
  messages: PromptChatTurn[];
  variables: PromptRuntimeVariable[];
  traceId: string;
  threadId: string;
}): StudioClientEvent {
  const { messagesHistory, inputs } = resolvePromptInputs({
    formValues,
    messages,
    variables,
  });

  return {
    type: "execute_component",
    payload: {
      enable_tracing: true,
      trace_id: traceId,
      thread_id: threadId,
      workflow: buildWorkflow({
        workflowId: `prompt_execution_${nanoid(6)}`,
        formValues,
        messagesHistory,
      }),
      node_id: PROMPT_NODE_ID,
      inputs: { ...inputs, messages: messagesHistory },
      origin: "playground",
    },
  } as StudioClientEvent;
}

/** The output fields a run streams, defaulting to the single `output` field. */
export function outputConfigsFor(formValues: PromptConfigFormValues) {
  return (
    formValues.version.configData.outputs ?? [
      { identifier: "output", type: "str" as const },
    ]
  );
}
