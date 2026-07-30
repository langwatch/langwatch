import { describe, expect, it } from "vitest";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { langyConversation } from "./aggregate";

/**
 * Every event key is chosen so the derived type string reproduces the legacy
 * `LANGY_CONVERSATION_EVENT_TYPES` string exactly — the browser's own fold
 * discriminates on those strings, and `event_log` already holds them.
 */

function snakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const LEGACY_PREFIX = "lw";
const AGGREGATE_NAME = "langy_conversation";

const EVENT_KEY_TO_LEGACY_CONSTANT = {
  conversationStarted: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
  conversationForked: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
  messageRecorded: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
  messageImported: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
  agentTurnAccepted: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  toolCallInitiated: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  toolCallSucceeded: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  toolCallFailed: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  planUpdated: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
  agentResponseFailed: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  agentResponded: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  conversationArchived: LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  conversationMetadataUpdated: LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
  conversationHandoffPending: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
  conversationHandoffConsumed: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
  conversationTitleGenerated: LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
} as const;

describe("langyConversation event keys reproduce the legacy type strings", () => {
  it("derives every legacy string from its event key via prefix + snake_case", () => {
    for (const [key, legacy] of Object.entries(EVENT_KEY_TO_LEGACY_CONSTANT)) {
      const derived = `${LEGACY_PREFIX}.${AGGREGATE_NAME}.${snakeCase(key)}`;
      expect(derived).toBe(legacy);
    }
  });

  it("covers every event key the aggregate actually declares, in both directions", () => {
    const declaredKeys = Object.keys(langyConversation.events).sort();
    const mappedKeys = Object.keys(EVENT_KEY_TO_LEGACY_CONSTANT).sort();
    expect(declaredKeys).toEqual(mappedKeys);
  });

  it("covers every legacy constant, so none is silently unreachable from this aggregate", () => {
    const mappedLegacyValues = new Set(Object.values(EVENT_KEY_TO_LEGACY_CONSTANT));
    const allLegacyValues = Object.values(LANGY_CONVERSATION_EVENT_TYPES);
    expect(allLegacyValues.every((value) => mappedLegacyValues.has(value))).toBe(true);
  });
});
