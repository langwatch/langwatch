/**
 * Builds the Liquid context a prompt agent's template renders against when it
 * runs as the agent under test in a simulation.
 *
 * Before #6590 this context held exactly two names, `input` and `messages`, so
 * a prompt's own declared input variables were never bound: they rendered as
 * empty strings and the model was shown a form with blank fields. `messages`
 * was a raw `JSON.stringify` of the conversation, which carries the internal
 * `id` and `traceId` the scenario runner stamps on every message — those
 * reached the model as prompt text.
 *
 * Declared inputs are bound through the same field-mapping machinery the code,
 * HTTP and workflow adapters use, so a prompt behaves like every other target:
 * an explicit mapping wins, and anything left over is matched against the
 * scenario sources by name (`question` → the latest user message, `thread_id` →
 * the thread id, and so on).
 */

import type { AgentInput } from "@langwatch/scenario";
import type { RunParameterValues } from "../parameters";
import {
  computeBestMatchMappings,
  resolveFieldMappings,
  sourceFieldOf,
} from "./resolve-field-mappings";
import type { FieldMapping } from "./types";

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

/** Placeholder rendered in place of an input nothing could be bound to. */
export function unboundInputPlaceholder(identifier: string): string {
  return `[unbound input: ${identifier}]`;
}

/** Sentinel used when the runner supplies no thread id. */
const DEFAULT_SCENARIO_THREAD_ID = "scenario-test";

/**
 * The conversation as the model should see it: role and content only.
 *
 * `ScenarioState.addMessage` stamps every message with `id` and `traceId`, and
 * serialising the message objects wholesale put both into prompt text (#6590).
 * Stripping here covers the base `messages` binding and every mapping that
 * resolves to it, since both read from this value.
 */
function conversationForPrompt(
  messages: AgentInput["messages"],
): AgentInput["messages"] {
  return messages.map((message) => {
    const { role, content } = message as { role: unknown; content: unknown };
    return { role, content } as (typeof messages)[number];
  });
}

/**
 * The conversation rendered for a prompt: one `role: content` line per turn.
 *
 * A prompt template is prose, so history belongs in it as prose. It used to be
 * bound to `JSON.stringify(input.messages)`, which showed the model a
 * serialised payload — and a model shown a payload answers with one (#6590).
 * That reply then became the next turn's history and was serialised again, so
 * each turn's prompt carried the previous turn's escaped one level deeper: an
 * instrumented four-turn run grew ×14.5 while the conversation itself grew
 * ×3.6.
 *
 * Note this is a change in what `{{messages}}` renders. A template that parsed
 * it as JSON has to loop the turns instead — and could not have been doing so
 * safely anyway, since the array it received carried internal fields.
 */
function transcriptForPrompt(messages: AgentInput["messages"]): string {
  return messages
    .map((message) => {
      const { role, content } = message as { role: string; content: unknown };
      const text =
        typeof content === "string" ? content : JSON.stringify(content);
      return `${role}: ${text}`;
    })
    .join("\n");
}

function lastUserMessageText(messages: AgentInput["messages"]): string {
  const lastUserMessage = messages.findLast((m) => m.role === "user");
  if (!lastUserMessage) return "";
  return typeof lastUserMessage.content === "string"
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage.content);
}

/**
 * Build the template context for one turn.
 *
 * @param input - The turn the scenario runner handed the adapter
 * @param inputs - The prompt's declared input variables
 * @param scenarioMappings - Explicit bindings configured on the suite target.
 *   These win; every declared input they leave out is matched by name.
 * @param parameters - The values the run resolved, bound as `params` so the
 *   template reads `{{ params.account_tier }}`. Bound before the declared
 *   inputs, so an input a customer already named `params` still wins.
 */
export function buildPromptTemplateContext({
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
    // The shared resolver serialises the conversation as JSON, which is right
    // for an HTTP body and wrong for prompt text. Same substitution as the base
    // `messages` binding, so a declared input mapped to the conversation reads
    // the same way. `threadId` likewise reads the base binding: the resolver
    // answers "" when the runner supplies no thread id, which would render
    // blank while `{{threadId}}` renders the sentinel.
    const sourceField = sourceFieldOf(effectiveMappings[identifier]!);
    context[identifier] =
      sourceField === "messages"
        ? transcript
        : sourceField === "threadId"
          ? threadId
          : value;
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
  return expressions.map((expression) =>
    expression.replace(/"[^"]*"|'[^']*'/g, '""'),
  );
}

/**
 * Whether a template reads the named variable.
 *
 * The check this replaces tested `/\bmessages\b/` against the raw template, so
 * a system prompt using the ordinary word "messages" in prose suppressed the
 * conversation history entirely — the model was told to discuss a conversation
 * it was never shown. Only a reference inside a Liquid expression counts now.
 */
export function templateReferencesVariable(
  template: string,
  variable: string,
): boolean {
  const reference = new RegExp(`\\b${variable}\\b`);
  return liquidExpressions(template).some((expression) =>
    reference.test(expression),
  );
}

/**
 * Every context name `buildPromptTemplateContext` binds the conversation to.
 *
 * ⚠ Both spellings must stay listed: a caller uses this to decide whether the
 * template already places the history, and a name missing here is history
 * appended a second time.
 */
const CONVERSATION_VARIABLES = ["messages", "messagesJson"] as const;

/**
 * Whether a template places the conversation history itself, in either the
 * prose or the structured form.
 */
export function templateReferencesConversation(template: string): boolean {
  return CONVERSATION_VARIABLES.some((variable) =>
    templateReferencesVariable(template, variable),
  );
}
