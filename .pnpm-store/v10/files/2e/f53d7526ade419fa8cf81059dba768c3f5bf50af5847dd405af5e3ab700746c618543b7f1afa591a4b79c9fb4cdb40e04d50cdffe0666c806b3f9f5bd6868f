// src/types.ts
import { z } from "zod";
var FunctionCallSchema = z.object({
  name: z.string(),
  arguments: z.string()
});
var ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: FunctionCallSchema
});
var BaseMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string().optional(),
  name: z.string().optional()
});
var DeveloperMessageSchema = BaseMessageSchema.extend({
  role: z.literal("developer"),
  content: z.string()
});
var SystemMessageSchema = BaseMessageSchema.extend({
  role: z.literal("system"),
  content: z.string()
});
var AssistantMessageSchema = BaseMessageSchema.extend({
  role: z.literal("assistant"),
  content: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional()
});
var UserMessageSchema = BaseMessageSchema.extend({
  role: z.literal("user"),
  content: z.string()
});
var ToolMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.literal("tool"),
  toolCallId: z.string()
});
var MessageSchema = z.discriminatedUnion("role", [
  DeveloperMessageSchema,
  SystemMessageSchema,
  AssistantMessageSchema,
  UserMessageSchema,
  ToolMessageSchema
]);
var RoleSchema = z.union([
  z.literal("developer"),
  z.literal("system"),
  z.literal("assistant"),
  z.literal("user"),
  z.literal("tool")
]);
var ContextSchema = z.object({
  description: z.string(),
  value: z.string()
});
var ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.any()
  // JSON Schema for the tool parameters
});
var RunAgentInputSchema = z.object({
  threadId: z.string(),
  runId: z.string(),
  state: z.any(),
  messages: z.array(MessageSchema),
  tools: z.array(ToolSchema),
  context: z.array(ContextSchema),
  forwardedProps: z.any()
});
var StateSchema = z.any();
var AGUIError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// src/events.ts
import { z as z2 } from "zod";
var EventType = /* @__PURE__ */ ((EventType2) => {
  EventType2["TEXT_MESSAGE_START"] = "TEXT_MESSAGE_START";
  EventType2["TEXT_MESSAGE_CONTENT"] = "TEXT_MESSAGE_CONTENT";
  EventType2["TEXT_MESSAGE_END"] = "TEXT_MESSAGE_END";
  EventType2["TEXT_MESSAGE_CHUNK"] = "TEXT_MESSAGE_CHUNK";
  EventType2["TOOL_CALL_START"] = "TOOL_CALL_START";
  EventType2["TOOL_CALL_ARGS"] = "TOOL_CALL_ARGS";
  EventType2["TOOL_CALL_END"] = "TOOL_CALL_END";
  EventType2["TOOL_CALL_CHUNK"] = "TOOL_CALL_CHUNK";
  EventType2["STATE_SNAPSHOT"] = "STATE_SNAPSHOT";
  EventType2["STATE_DELTA"] = "STATE_DELTA";
  EventType2["MESSAGES_SNAPSHOT"] = "MESSAGES_SNAPSHOT";
  EventType2["RAW"] = "RAW";
  EventType2["CUSTOM"] = "CUSTOM";
  EventType2["RUN_STARTED"] = "RUN_STARTED";
  EventType2["RUN_FINISHED"] = "RUN_FINISHED";
  EventType2["RUN_ERROR"] = "RUN_ERROR";
  EventType2["STEP_STARTED"] = "STEP_STARTED";
  EventType2["STEP_FINISHED"] = "STEP_FINISHED";
  return EventType2;
})(EventType || {});
var BaseEventSchema = z2.object({
  type: z2.nativeEnum(EventType),
  timestamp: z2.number().optional(),
  rawEvent: z2.any().optional()
});
var RunStartedSchema = BaseEventSchema.extend({
  type: z2.literal("RUN_STARTED" /* RUN_STARTED */),
  threadId: z2.string(),
  runId: z2.string()
});
var RunFinishedSchema = BaseEventSchema.extend({
  type: z2.literal("RUN_FINISHED" /* RUN_FINISHED */),
  threadId: z2.string(),
  runId: z2.string()
});
var RunErrorSchema = BaseEventSchema.extend({
  type: z2.literal("RUN_ERROR" /* RUN_ERROR */),
  message: z2.string(),
  code: z2.string().optional()
});
var StepStartedSchema = BaseEventSchema.extend({
  type: z2.literal("STEP_STARTED" /* STEP_STARTED */),
  stepName: z2.string()
});
var StepFinishedSchema = BaseEventSchema.extend({
  type: z2.literal("STEP_FINISHED" /* STEP_FINISHED */),
  stepName: z2.string()
});
var TextMessageStartEventSchema = BaseEventSchema.extend({
  type: z2.literal("TEXT_MESSAGE_START" /* TEXT_MESSAGE_START */),
  messageId: z2.string(),
  role: z2.literal("assistant")
});
var TextMessageContentEventSchema = BaseEventSchema.extend({
  type: z2.literal("TEXT_MESSAGE_CONTENT" /* TEXT_MESSAGE_CONTENT */),
  messageId: z2.string(),
  delta: z2.string().refine((s) => s.length > 0, "Delta must not be an empty string")
});
var TextMessageEndEventSchema = BaseEventSchema.extend({
  type: z2.literal("TEXT_MESSAGE_END" /* TEXT_MESSAGE_END */),
  messageId: z2.string()
});
var TextMessageChunkEventSchema = BaseEventSchema.extend({
  type: z2.literal("TEXT_MESSAGE_CHUNK" /* TEXT_MESSAGE_CHUNK */),
  messageId: z2.string().optional(),
  role: z2.literal("assistant").optional(),
  delta: z2.string().optional()
});
var ToolCallStartEventSchema = BaseEventSchema.extend({
  type: z2.literal("TOOL_CALL_START" /* TOOL_CALL_START */),
  toolCallId: z2.string(),
  toolCallName: z2.string(),
  parentMessageId: z2.string().optional()
});
var ToolCallArgsEventSchema = BaseEventSchema.extend({
  type: z2.literal("TOOL_CALL_ARGS" /* TOOL_CALL_ARGS */),
  toolCallId: z2.string(),
  delta: z2.string()
});
var ToolCallEndEventSchema = BaseEventSchema.extend({
  type: z2.literal("TOOL_CALL_END" /* TOOL_CALL_END */),
  toolCallId: z2.string()
});
var ToolCallChunkEventSchema = BaseEventSchema.extend({
  type: z2.literal("TOOL_CALL_CHUNK" /* TOOL_CALL_CHUNK */),
  toolCallId: z2.string().optional(),
  toolCallName: z2.string().optional(),
  parentMessageId: z2.string().optional(),
  delta: z2.string().optional()
});
var StateSnapshotEventSchema = BaseEventSchema.extend({
  type: z2.literal("STATE_SNAPSHOT" /* STATE_SNAPSHOT */),
  snapshot: StateSchema
});
var StateDeltaEventSchema = BaseEventSchema.extend({
  type: z2.literal("STATE_DELTA" /* STATE_DELTA */),
  delta: z2.array(z2.any())
  // JSON Patch (RFC 6902)
});
var MessagesSnapshotEventSchema = BaseEventSchema.extend({
  type: z2.literal("MESSAGES_SNAPSHOT" /* MESSAGES_SNAPSHOT */),
  messages: z2.array(MessageSchema)
});
var RawEventSchema = BaseEventSchema.extend({
  type: z2.literal("RAW" /* RAW */),
  event: z2.any(),
  source: z2.string().optional()
});
var CustomEventSchema = BaseEventSchema.extend({
  type: z2.literal("CUSTOM" /* CUSTOM */),
  name: z2.string(),
  value: z2.any()
});
var RunStartedEventSchema = BaseEventSchema.extend({
  type: z2.literal("RUN_STARTED" /* RUN_STARTED */),
  threadId: z2.string(),
  runId: z2.string()
});
var RunFinishedEventSchema = BaseEventSchema.extend({
  type: z2.literal("RUN_FINISHED" /* RUN_FINISHED */),
  threadId: z2.string(),
  runId: z2.string()
});
var RunErrorEventSchema = BaseEventSchema.extend({
  type: z2.literal("RUN_ERROR" /* RUN_ERROR */),
  message: z2.string(),
  code: z2.string().optional()
});
var StepStartedEventSchema = BaseEventSchema.extend({
  type: z2.literal("STEP_STARTED" /* STEP_STARTED */),
  stepName: z2.string()
});
var StepFinishedEventSchema = BaseEventSchema.extend({
  type: z2.literal("STEP_FINISHED" /* STEP_FINISHED */),
  stepName: z2.string()
});
var EventSchemas = z2.discriminatedUnion("type", [
  TextMessageStartEventSchema,
  TextMessageContentEventSchema,
  TextMessageEndEventSchema,
  TextMessageChunkEventSchema,
  ToolCallStartEventSchema,
  ToolCallArgsEventSchema,
  ToolCallEndEventSchema,
  ToolCallChunkEventSchema,
  StateSnapshotEventSchema,
  StateDeltaEventSchema,
  MessagesSnapshotEventSchema,
  RawEventSchema,
  CustomEventSchema,
  RunStartedEventSchema,
  RunFinishedEventSchema,
  RunErrorEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema
]);
export {
  AGUIError,
  AssistantMessageSchema,
  BaseMessageSchema,
  ContextSchema,
  CustomEventSchema,
  DeveloperMessageSchema,
  EventSchemas,
  EventType,
  FunctionCallSchema,
  MessageSchema,
  MessagesSnapshotEventSchema,
  RawEventSchema,
  RoleSchema,
  RunAgentInputSchema,
  RunErrorEventSchema,
  RunErrorSchema,
  RunFinishedEventSchema,
  RunFinishedSchema,
  RunStartedEventSchema,
  RunStartedSchema,
  StateDeltaEventSchema,
  StateSchema,
  StateSnapshotEventSchema,
  StepFinishedEventSchema,
  StepFinishedSchema,
  StepStartedEventSchema,
  StepStartedSchema,
  SystemMessageSchema,
  TextMessageChunkEventSchema,
  TextMessageContentEventSchema,
  TextMessageEndEventSchema,
  TextMessageStartEventSchema,
  ToolCallArgsEventSchema,
  ToolCallChunkEventSchema,
  ToolCallEndEventSchema,
  ToolCallSchema,
  ToolCallStartEventSchema,
  ToolMessageSchema,
  ToolSchema,
  UserMessageSchema
};
//# sourceMappingURL=index.mjs.map