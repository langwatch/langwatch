"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AGUIError: () => AGUIError,
  AssistantMessageSchema: () => AssistantMessageSchema,
  BaseMessageSchema: () => BaseMessageSchema,
  ContextSchema: () => ContextSchema,
  CustomEventSchema: () => CustomEventSchema,
  DeveloperMessageSchema: () => DeveloperMessageSchema,
  EventSchemas: () => EventSchemas,
  EventType: () => EventType,
  FunctionCallSchema: () => FunctionCallSchema,
  MessageSchema: () => MessageSchema,
  MessagesSnapshotEventSchema: () => MessagesSnapshotEventSchema,
  RawEventSchema: () => RawEventSchema,
  RoleSchema: () => RoleSchema,
  RunAgentInputSchema: () => RunAgentInputSchema,
  RunErrorEventSchema: () => RunErrorEventSchema,
  RunErrorSchema: () => RunErrorSchema,
  RunFinishedEventSchema: () => RunFinishedEventSchema,
  RunFinishedSchema: () => RunFinishedSchema,
  RunStartedEventSchema: () => RunStartedEventSchema,
  RunStartedSchema: () => RunStartedSchema,
  StateDeltaEventSchema: () => StateDeltaEventSchema,
  StateSchema: () => StateSchema,
  StateSnapshotEventSchema: () => StateSnapshotEventSchema,
  StepFinishedEventSchema: () => StepFinishedEventSchema,
  StepFinishedSchema: () => StepFinishedSchema,
  StepStartedEventSchema: () => StepStartedEventSchema,
  StepStartedSchema: () => StepStartedSchema,
  SystemMessageSchema: () => SystemMessageSchema,
  TextMessageChunkEventSchema: () => TextMessageChunkEventSchema,
  TextMessageContentEventSchema: () => TextMessageContentEventSchema,
  TextMessageEndEventSchema: () => TextMessageEndEventSchema,
  TextMessageStartEventSchema: () => TextMessageStartEventSchema,
  ToolCallArgsEventSchema: () => ToolCallArgsEventSchema,
  ToolCallChunkEventSchema: () => ToolCallChunkEventSchema,
  ToolCallEndEventSchema: () => ToolCallEndEventSchema,
  ToolCallSchema: () => ToolCallSchema,
  ToolCallStartEventSchema: () => ToolCallStartEventSchema,
  ToolMessageSchema: () => ToolMessageSchema,
  ToolSchema: () => ToolSchema,
  UserMessageSchema: () => UserMessageSchema
});
module.exports = __toCommonJS(index_exports);

// src/types.ts
var import_zod = require("zod");
var FunctionCallSchema = import_zod.z.object({
  name: import_zod.z.string(),
  arguments: import_zod.z.string()
});
var ToolCallSchema = import_zod.z.object({
  id: import_zod.z.string(),
  type: import_zod.z.literal("function"),
  function: FunctionCallSchema
});
var BaseMessageSchema = import_zod.z.object({
  id: import_zod.z.string(),
  role: import_zod.z.string(),
  content: import_zod.z.string().optional(),
  name: import_zod.z.string().optional()
});
var DeveloperMessageSchema = BaseMessageSchema.extend({
  role: import_zod.z.literal("developer"),
  content: import_zod.z.string()
});
var SystemMessageSchema = BaseMessageSchema.extend({
  role: import_zod.z.literal("system"),
  content: import_zod.z.string()
});
var AssistantMessageSchema = BaseMessageSchema.extend({
  role: import_zod.z.literal("assistant"),
  content: import_zod.z.string().optional(),
  toolCalls: import_zod.z.array(ToolCallSchema).optional()
});
var UserMessageSchema = BaseMessageSchema.extend({
  role: import_zod.z.literal("user"),
  content: import_zod.z.string()
});
var ToolMessageSchema = import_zod.z.object({
  id: import_zod.z.string(),
  content: import_zod.z.string(),
  role: import_zod.z.literal("tool"),
  toolCallId: import_zod.z.string()
});
var MessageSchema = import_zod.z.discriminatedUnion("role", [
  DeveloperMessageSchema,
  SystemMessageSchema,
  AssistantMessageSchema,
  UserMessageSchema,
  ToolMessageSchema
]);
var RoleSchema = import_zod.z.union([
  import_zod.z.literal("developer"),
  import_zod.z.literal("system"),
  import_zod.z.literal("assistant"),
  import_zod.z.literal("user"),
  import_zod.z.literal("tool")
]);
var ContextSchema = import_zod.z.object({
  description: import_zod.z.string(),
  value: import_zod.z.string()
});
var ToolSchema = import_zod.z.object({
  name: import_zod.z.string(),
  description: import_zod.z.string(),
  parameters: import_zod.z.any()
  // JSON Schema for the tool parameters
});
var RunAgentInputSchema = import_zod.z.object({
  threadId: import_zod.z.string(),
  runId: import_zod.z.string(),
  state: import_zod.z.any(),
  messages: import_zod.z.array(MessageSchema),
  tools: import_zod.z.array(ToolSchema),
  context: import_zod.z.array(ContextSchema),
  forwardedProps: import_zod.z.any()
});
var StateSchema = import_zod.z.any();
var AGUIError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// src/events.ts
var import_zod2 = require("zod");
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
var BaseEventSchema = import_zod2.z.object({
  type: import_zod2.z.nativeEnum(EventType),
  timestamp: import_zod2.z.number().optional(),
  rawEvent: import_zod2.z.any().optional()
});
var RunStartedSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RUN_STARTED" /* RUN_STARTED */),
  threadId: import_zod2.z.string(),
  runId: import_zod2.z.string()
});
var RunFinishedSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RUN_FINISHED" /* RUN_FINISHED */),
  threadId: import_zod2.z.string(),
  runId: import_zod2.z.string()
});
var RunErrorSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RUN_ERROR" /* RUN_ERROR */),
  message: import_zod2.z.string(),
  code: import_zod2.z.string().optional()
});
var StepStartedSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("STEP_STARTED" /* STEP_STARTED */),
  stepName: import_zod2.z.string()
});
var StepFinishedSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("STEP_FINISHED" /* STEP_FINISHED */),
  stepName: import_zod2.z.string()
});
var TextMessageStartEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TEXT_MESSAGE_START" /* TEXT_MESSAGE_START */),
  messageId: import_zod2.z.string(),
  role: import_zod2.z.literal("assistant")
});
var TextMessageContentEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TEXT_MESSAGE_CONTENT" /* TEXT_MESSAGE_CONTENT */),
  messageId: import_zod2.z.string(),
  delta: import_zod2.z.string().refine((s) => s.length > 0, "Delta must not be an empty string")
});
var TextMessageEndEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TEXT_MESSAGE_END" /* TEXT_MESSAGE_END */),
  messageId: import_zod2.z.string()
});
var TextMessageChunkEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TEXT_MESSAGE_CHUNK" /* TEXT_MESSAGE_CHUNK */),
  messageId: import_zod2.z.string().optional(),
  role: import_zod2.z.literal("assistant").optional(),
  delta: import_zod2.z.string().optional()
});
var ToolCallStartEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TOOL_CALL_START" /* TOOL_CALL_START */),
  toolCallId: import_zod2.z.string(),
  toolCallName: import_zod2.z.string(),
  parentMessageId: import_zod2.z.string().optional()
});
var ToolCallArgsEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TOOL_CALL_ARGS" /* TOOL_CALL_ARGS */),
  toolCallId: import_zod2.z.string(),
  delta: import_zod2.z.string()
});
var ToolCallEndEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TOOL_CALL_END" /* TOOL_CALL_END */),
  toolCallId: import_zod2.z.string()
});
var ToolCallChunkEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("TOOL_CALL_CHUNK" /* TOOL_CALL_CHUNK */),
  toolCallId: import_zod2.z.string().optional(),
  toolCallName: import_zod2.z.string().optional(),
  parentMessageId: import_zod2.z.string().optional(),
  delta: import_zod2.z.string().optional()
});
var StateSnapshotEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("STATE_SNAPSHOT" /* STATE_SNAPSHOT */),
  snapshot: StateSchema
});
var StateDeltaEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("STATE_DELTA" /* STATE_DELTA */),
  delta: import_zod2.z.array(import_zod2.z.any())
  // JSON Patch (RFC 6902)
});
var MessagesSnapshotEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("MESSAGES_SNAPSHOT" /* MESSAGES_SNAPSHOT */),
  messages: import_zod2.z.array(MessageSchema)
});
var RawEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RAW" /* RAW */),
  event: import_zod2.z.any(),
  source: import_zod2.z.string().optional()
});
var CustomEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("CUSTOM" /* CUSTOM */),
  name: import_zod2.z.string(),
  value: import_zod2.z.any()
});
var RunStartedEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RUN_STARTED" /* RUN_STARTED */),
  threadId: import_zod2.z.string(),
  runId: import_zod2.z.string()
});
var RunFinishedEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RUN_FINISHED" /* RUN_FINISHED */),
  threadId: import_zod2.z.string(),
  runId: import_zod2.z.string()
});
var RunErrorEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("RUN_ERROR" /* RUN_ERROR */),
  message: import_zod2.z.string(),
  code: import_zod2.z.string().optional()
});
var StepStartedEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("STEP_STARTED" /* STEP_STARTED */),
  stepName: import_zod2.z.string()
});
var StepFinishedEventSchema = BaseEventSchema.extend({
  type: import_zod2.z.literal("STEP_FINISHED" /* STEP_FINISHED */),
  stepName: import_zod2.z.string()
});
var EventSchemas = import_zod2.z.discriminatedUnion("type", [
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
//# sourceMappingURL=index.js.map