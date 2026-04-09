/**
 * Field mapping resolution for scenario execution.
 *
 * Resolves fieldMappings from TargetConfig into concrete string values
 * by extracting data from the AgentInput provided by the scenario runner.
 */

import type { AgentInput } from "@langwatch/scenario";
import type { FieldMapping } from "./types";

/**
 * Resolve a record of field mappings to concrete string values.
 *
 * Source resolution rules:
 * - `sourceId: "scenario"`, `path: ["input"]` — last user message content
 * - `sourceId: "scenario"`, `path: ["messages"]` — full messages array as JSON string
 * - `sourceId: "scenario"`, `path: ["threadId"]` — thread ID, empty string if absent
 * - `type: "value"` — the literal value string
 *
 * @param fieldMappings - Map of input identifier → mapping definition
 * @param agentInput - Runtime input provided by the scenario runner
 * @returns Map of input identifier → resolved string value
 */
export function resolveFieldMappings({
  fieldMappings,
  agentInput,
}: {
  fieldMappings: Record<string, FieldMapping>;
  agentInput: AgentInput;
}): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [identifier, mapping] of Object.entries(fieldMappings)) {
    resolved[identifier] = resolveMapping({ mapping, agentInput });
  }

  return resolved;
}

function resolveMapping({
  mapping,
  agentInput,
}: {
  mapping: FieldMapping;
  agentInput: AgentInput;
}): string {
  if (mapping.type === "value") {
    return mapping.value;
  }

  // Source mapping — only "scenario" sourceId is supported currently
  if (mapping.sourceId !== "scenario") {
    return "";
  }

  const [field] = mapping.path;

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

function extractLastUserMessage(agentInput: AgentInput): string {
  const lastUserMessage = agentInput.messages.findLast((m) => m.role === "user");
  if (!lastUserMessage) return "";
  return typeof lastUserMessage.content === "string"
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage.content);
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

/**
 * Compute best-match field mappings by matching agent input identifiers
 * to scenario source fields.
 *
 * Matching rules:
 * - Exact or alias match (case-insensitive) → map to that source field
 * - No match and only one input → default to input
 * - No match and multiple inputs → leave unmapped
 *
 * @param inputs - Array of agent input definitions
 * @returns Mappings for inputs that matched, empty record if none matched
 */
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

  // If only one input and nothing matched, default to input
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
    if (usedFields.has(field)) continue;
    if (aliases.some((alias) => alias === normalizedIdentifier)) {
      return field;
    }
  }
  return undefined;
}
