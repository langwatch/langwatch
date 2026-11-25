/**
 * Builds the Liquid context for prompt agent's template: declared inputs bound
 * through field-mapping machinery (same as code/HTTP/workflow adapters). Sanitizes
 * `messages` to role/content only; stripping id/traceId (#6590).
 */

import type { AgentInput } from "@langwatch/scenario";
import {
  computeBestMatchMappings,
  resolveFieldMappings,
  extractSourceField,
  type FieldMapping,
  type RunParameterValues,
} from "@langwatch/scenario-contract";

/** An input variable declared on the prompt. */
export interface PromptInputDeclaration {
  identifier: string;
  type?: string;
}

export interface PromptTemplateContextResult {
  /** Names and values the Liquid template renders against. */
  context: Record<string, unknown>;
  /**
   * Declared inputs a simulation has no value for. Reported by the caller so
   * the reason an answer looks wrong is visible next to the run, not inferred.
   */
  unboundInputs: string[];
}

/** Sentinel used when the runner supplies no thread id. */
const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

/**
 * Every context name `buildPromptTemplateContext` binds the conversation to.
 * ⚠ Both spellings must stay listed: a caller uses this to decide whether the
 * template already places history, or appends it a second time.
 */
const CONVERSATION_VARIABLES = ["messages", "messagesJson"] as const;

/** Placeholder rendered in place of an input nothing could be bound to. */
function unboundInputPlaceholder(identifier: string): string {
  return `[unbound input: ${identifier}]`;
}

/**
 * The conversation as the model should see it: role and content only, since
 * `ScenarioState.addMessage`'s `id`/`traceId` stamps leaked into prompt text
 * when serialised wholesale (#6590). Covers `messages` and every mapping to it.
 */
function conversationForPrompt(messages: AgentInput["messages"]): AgentInput["messages"] {
  return messages.map((message) => {
    const { role, content } = message as { role: unknown; content: unknown };
    return { role, content } as (typeof messages)[number];
  });
}

/**
 * Conversation as prose for prompt: one `role: content` line per turn. Avoids
 * serialization recursion of #6590 (JSON.stringify carried internal fields).
 */
function transcriptForPrompt(messages: AgentInput["messages"]): string {
  return messages
    .map((message) => {
      const { role, content } = message as { role: string; content: unknown };
      const text = typeof content === "string" ? content : JSON.stringify(content);
      return `${role}: ${text}`;
    })
    .join("\n");
}

function lastUserMessageText(messages: AgentInput["messages"]): string {
  let lastUserMessage: AgentInput["messages"][number] | undefined;
  for (const message of messages) {
    if (message.role === "user") lastUserMessage = message;
  }
  if (!lastUserMessage) return "";
  return typeof lastUserMessage.content === "string"
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage.content);
}

/**
 * Build template context for one turn: input + messages + thread_id + params.
 * Explicit mappings win; unbound inputs matched by name.
 */
export function buildContext({
  input,
  inputs = [],
  scenarioMappings,
  parameters,
}: {
  input: AgentInput;
  inputs?: PromptInputDeclaration[];
  scenarioMappings?: Record<string, FieldMapping>;
  parameters?: RunParameterValues;
}): PromptTemplateContextResult {
  const sanitized = {
    ...input,
    messages: conversationForPrompt(input.messages),
  } as AgentInput;

  const transcript = transcriptForPrompt(sanitized.messages);

  const threadId = input.threadId ?? DEFAULT_SCENARIO_THREAD_ID;

  const context: Record<string, unknown> = {
    input: lastUserMessageText(sanitized.messages),
    messages: transcript,
    // The structured escape hatch for templates that parsed the pre-#6590
    // `{{messages}}` JSON: the same array shape, minus the internal `id` /
    // `traceId` fields that made the old value unsafe to consume. `{{messages}}`
    // itself stays prose because a model shown a JSON transcript answers with
    // one, and that reply re-escapes one level deeper every turn (#6590).
    messagesJson: JSON.stringify(sanitized.messages),
    threadId,
    params: parameters ?? {},
  };

  const effectiveMappings: Record<string, FieldMapping> = {
    ...computeBestMatchMappings({ inputs }),
    ...scenarioMappings,
  };

  const resolved = resolveFieldMappings({
    fieldMappings: effectiveMappings,
    agentInput: sanitized,
  });
  for (const [identifier, value] of Object.entries(resolved)) {
    // The shared resolver serialises the conversation as JSON, right for an
    // HTTP body but wrong for prompt text, so mapped inputs substitute the
    // same as the base `messages`/`threadId` bindings for consistency.
    const sourceField = extractSourceField(effectiveMappings[identifier]!);
    if (sourceField === "messages") {
      context[identifier] = transcript;
    } else if (sourceField === "threadId") {
      context[identifier] = threadId;
    } else {
      context[identifier] = value;
    }
  }

  const unboundInputs = inputs
    .map((declared) => declared.identifier)
    .filter((identifier) => resolved[identifier] === undefined);

  for (const identifier of unboundInputs) {
    context[identifier] = unboundInputPlaceholder(identifier);
  }

  return { context, unboundInputs };
}

/**
 * Liquid expressions — `{{ ... }}` and `{% ... %}` — with quoted literals
 * blanked, so a variable name only counts where the template could actually
 * read it.
 */
function liquidExpressions(template: string): string[] {
  const expressions = template.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? [];
  return expressions.map((expression) => expression.replace(/"[^"]*"|'[^']*'/g, '""'));
}

/**
 * Whether a template reads the named variable. The prior check tested
 * `/\bmessages\b/` against raw text, so the word "messages" in prose alone
 * suppressed history entirely. Only a Liquid-expression reference counts now.
 */
export function referencesVariable(template: string, variable: string): boolean {
  const reference = new RegExp(`\\b${variable}\\b`);
  return liquidExpressions(template).some((expression) => reference.test(expression));
}

/**
 * Whether a template places the conversation history itself, in either the
 * prose or the structured form.
 */
export function referencesConversation(template: string): boolean {
  return CONVERSATION_VARIABLES.some((variable) => referencesVariable(template, variable));
}
