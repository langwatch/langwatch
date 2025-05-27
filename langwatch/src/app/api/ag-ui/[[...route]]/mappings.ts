/**
 * AG-UI ES Event Mappings
 * @see https://docs.ag-ui.com/sdk/js/core/events
 */

import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";

// Base event mapping (common to all events)
const baseEventMapping = {
  type: { type: "keyword" },
  timestamp: { type: "date" },
  projectId: { type: "keyword" },
};

// Lifecycle events (RUN_STARTED, RUN_FINISHED, RUN_ERROR, STEP_STARTED, STEP_FINISHED)
const lifecycleEventMapping = {
  threadId: { type: "keyword" },
  runId: { type: "keyword" },
  message: { type: "text" }, // For RUN_ERROR
  code: { type: "keyword" }, // For RUN_ERROR
  stepName: { type: "keyword" }, // For STEP events
};

// Text message events (TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END)
const textMessageEventMapping = {
  messageId: { type: "keyword" },
  role: { type: "keyword" }, // Always "assistant"
  delta: { type: "text" }, // For content chunks
};

// Tool call events (TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END)
const toolCallEventMapping = {
  toolCallId: { type: "keyword" },
  toolCallName: { type: "keyword" },
  parentMessageId: { type: "keyword" },
  delta: { type: "text" }, // For args chunks
};

// State management events (STATE_SNAPSHOT, STATE_DELTA, MESSAGES_SNAPSHOT)
const stateEventMapping = {
  snapshot: { type: "object" }, // For STATE_SNAPSHOT
  delta: { type: "object" }, // For STATE_DELTA
  messages: {
    type: "nested",
    properties: {
      id: { type: "keyword" },
      role: { type: "keyword" },
      content: { type: "text" },
    },
  },
};

const customEventMapping = {
  name: { type: "keyword" },
  value: { type: "object" },
};

const rawEventMapping = {
  event: { type: "object" },
  source: { type: "keyword" },
};

// Combine all mappings
export const eventMapping = {
  properties: {
    ...baseEventMapping,
    ...lifecycleEventMapping,
    ...textMessageEventMapping,
    ...toolCallEventMapping,
    ...stateEventMapping,
    ...customEventMapping,
    ...rawEventMapping,
  } as Record<string, MappingProperty>,
};
