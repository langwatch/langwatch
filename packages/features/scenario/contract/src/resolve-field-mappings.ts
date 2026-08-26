/** Portable field mapping shared by scenario authoring and execution. */

import type { FieldMapping } from "./field-mapping";

/** The portable part of a scenario runner turn used by input mapping. */
export type ScenarioInput = {
  messages: ReadonlyArray<{ role: string; content: unknown }>;
  threadId?: string;
};

/** Maps pre-rename field names to current names for backwards compatibility. */
const LEGACY_FIELD_NAMES: Record<string, string> = {
  scenario_message: "input",
  conversation_history: "messages",
  thread_id: "threadId",
};

/** Resolves input mappings to the scalar values expected by agent adapters. */
export function resolveFieldMappings({
  fieldMappings,
  agentInput,
}: {
  fieldMappings: Record<string, FieldMapping>;
  agentInput: ScenarioInput;
}): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [identifier, mapping] of Object.entries(fieldMappings)) {
    resolved[identifier] = resolveMapping({ mapping, agentInput });
  }

  return resolved;
}

/** Canonical scenario source fields a mapping can resolve to. */
export type ScenarioSourceField = "input" | "messages" | "threadId";

/** Returns the supported scenario source behind a mapping, when it has one. */
export function sourceFieldOf(mapping: FieldMapping): ScenarioSourceField | null {
  if (mapping.type === "value" || mapping.sourceId !== "scenario") {
    return null;
  }
  const [rawField] = mapping.path;
  const field = LEGACY_FIELD_NAMES[rawField ?? ""] ?? rawField;
  return field === "input" || field === "messages" || field === "threadId" ? field : null;
}

function resolveMapping({
  mapping,
  agentInput,
}: {
  mapping: FieldMapping;
  agentInput: ScenarioInput;
}): string {
  if (mapping.type === "value") {
    return mapping.value;
  }

  if (mapping.sourceId !== "scenario") {
    return "";
  }

  const [rawField] = mapping.path;
  const field = LEGACY_FIELD_NAMES[rawField ?? ""] ?? rawField;

  if (field === "input") {
    return extractLastUserMessage(agentInput);
  }

  if (field === "messages") {
    return JSON.stringify(agentInput.messages);
  }

  if (field === "threadId") {
    return agentInput.threadId ?? "";
  }

  return "";
}

function extractLastUserMessage(agentInput: ScenarioInput): string {
  let lastUserMessage: { role: string; content: unknown } | undefined;

  for (let index = agentInput.messages.length - 1; index >= 0; index -= 1) {
    const message = agentInput.messages[index];
    if (message?.role === "user") {
      lastUserMessage = message;
      break;
    }
  }

  if (!lastUserMessage) {
    return "";
  }

  if (typeof lastUserMessage.content === "string") {
    return lastUserMessage.content;
  }

  return JSON.stringify(lastUserMessage.content);
}

/**
 * Known scenario source fields and common aliases that should match them.
 * Used for best-match auto-mapping of agent inputs to scenario sources.
 */
const SCENARIO_FIELD_ALIASES: Record<string, string[]> = {
  input: [
    "input",
    "message",
    "scenario_message",
    "query",
    "question",
    "prompt",
    "text",
    "user_message",
    "user_input",
  ],
  messages: [
    "messages",
    "conversation_history",
    "history",
    "conversation",
    "chat_history",
    "context",
  ],
  threadId: [
    "threadid",
    "thread_id",
    "thread",
    "session_id",
    "sessionid",
    "session",
    "conversation_id",
  ],
};

/** Matches input identifiers to known scenario fields and aliases. */
export function computeBestMatchMappings({
  inputs,
}: {
  inputs: Array<{ identifier: string }>;
}): Record<string, FieldMapping> {
  const result: Record<string, FieldMapping> = {};
  const usedFields = new Set<string>();

  for (const input of inputs) {
    const normalized = input.identifier.toLowerCase();
    const matchedField = findMatchingField(normalized, usedFields);
    if (matchedField) {
      result[input.identifier] = {
        type: "source",
        sourceId: "scenario",
        path: [matchedField],
      };
      usedFields.add(matchedField);
    }
  }

  if (inputs.length === 1 && Object.keys(result).length === 0 && inputs[0]) {
    result[inputs[0].identifier] = {
      type: "source",
      sourceId: "scenario",
      path: ["input"],
    };
  }

  return result;
}

function findMatchingField(
  normalizedIdentifier: string,
  usedFields: Set<string>,
): string | undefined {
  for (const [field, aliases] of Object.entries(SCENARIO_FIELD_ALIASES)) {
    if (usedFields.has(field)) {
      continue;
    }

    if (aliases.some((alias) => alias === normalizedIdentifier)) {
      return field;
    }
  }

  return void 0;
}
