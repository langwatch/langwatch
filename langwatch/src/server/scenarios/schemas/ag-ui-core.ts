/**
 * Vendored subset of `@ag-ui/core` (v0.0.57; the message/event schemas below
 * are stable across 0.0.53–0.0.57).
 *
 * The scenario event schemas extend the AG-UI event/message contract, but the
 * only symbols we consume from the package are `EventType`, `MessageSchema`, and
 * `MessagesSnapshotEventSchema`. To avoid taking a runtime dependency on the
 * whole package for three schemas, they are reproduced here verbatim (same Zod
 * shapes, same validation behavior) so incoming SDK payloads validate
 * identically. Keep this file in sync if the AG-UI message/event contract
 * changes.
 *
 * @see https://www.npmjs.com/package/@ag-ui/core
 */
import { z } from "zod";

/**
 * AG-UI event type enum. Reproduced in full so `z.nativeEnum(EventType)` accepts
 * exactly the same set of event types as the upstream package.
 */
export enum EventType {
  TEXT_MESSAGE_START = "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END = "TEXT_MESSAGE_END",
  TEXT_MESSAGE_CHUNK = "TEXT_MESSAGE_CHUNK",
  TOOL_CALL_START = "TOOL_CALL_START",
  TOOL_CALL_ARGS = "TOOL_CALL_ARGS",
  TOOL_CALL_END = "TOOL_CALL_END",
  TOOL_CALL_CHUNK = "TOOL_CALL_CHUNK",
  TOOL_CALL_RESULT = "TOOL_CALL_RESULT",
  /** @deprecated Use REASONING_START instead. Will be removed in 1.0.0. */
  THINKING_START = "THINKING_START",
  /** @deprecated Use REASONING_END instead. Will be removed in 1.0.0. */
  THINKING_END = "THINKING_END",
  /** @deprecated Use REASONING_MESSAGE_START instead. Will be removed in 1.0.0. */
  THINKING_TEXT_MESSAGE_START = "THINKING_TEXT_MESSAGE_START",
  /** @deprecated Use REASONING_MESSAGE_CONTENT instead. Will be removed in 1.0.0. */
  THINKING_TEXT_MESSAGE_CONTENT = "THINKING_TEXT_MESSAGE_CONTENT",
  /** @deprecated Use REASONING_MESSAGE_END instead. Will be removed in 1.0.0. */
  THINKING_TEXT_MESSAGE_END = "THINKING_TEXT_MESSAGE_END",
  STATE_SNAPSHOT = "STATE_SNAPSHOT",
  STATE_DELTA = "STATE_DELTA",
  MESSAGES_SNAPSHOT = "MESSAGES_SNAPSHOT",
  ACTIVITY_SNAPSHOT = "ACTIVITY_SNAPSHOT",
  ACTIVITY_DELTA = "ACTIVITY_DELTA",
  RAW = "RAW",
  CUSTOM = "CUSTOM",
  RUN_STARTED = "RUN_STARTED",
  RUN_FINISHED = "RUN_FINISHED",
  RUN_ERROR = "RUN_ERROR",
  STEP_STARTED = "STEP_STARTED",
  STEP_FINISHED = "STEP_FINISHED",
  REASONING_START = "REASONING_START",
  REASONING_MESSAGE_START = "REASONING_MESSAGE_START",
  REASONING_MESSAGE_CONTENT = "REASONING_MESSAGE_CONTENT",
  REASONING_MESSAGE_END = "REASONING_MESSAGE_END",
  REASONING_MESSAGE_CHUNK = "REASONING_MESSAGE_CHUNK",
  REASONING_END = "REASONING_END",
  REASONING_ENCRYPTED_VALUE = "REASONING_ENCRYPTED_VALUE",
}

const FunctionCallSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: FunctionCallSchema,
  encryptedValue: z.string().optional(),
});

const BaseMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string().optional(),
  name: z.string().optional(),
  encryptedValue: z.string().optional(),
});

const TextInputContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const InputContentDataSourceSchema = z.object({
  type: z.literal("data"),
  value: z.string(),
  mimeType: z.string(),
});

const InputContentUrlSourceSchema = z.object({
  type: z.literal("url"),
  value: z.string(),
  mimeType: z.string().optional(),
});

const InputContentSourceSchema = z.discriminatedUnion("type", [
  InputContentDataSourceSchema,
  InputContentUrlSourceSchema,
]);

const ImageInputContentSchema = z.object({
  type: z.literal("image"),
  source: InputContentSourceSchema,
  metadata: z.unknown().optional(),
});

const AudioInputContentSchema = z.object({
  type: z.literal("audio"),
  source: InputContentSourceSchema,
  metadata: z.unknown().optional(),
});

const VideoInputContentSchema = z.object({
  type: z.literal("video"),
  source: InputContentSourceSchema,
  metadata: z.unknown().optional(),
});

const DocumentInputContentSchema = z.object({
  type: z.literal("document"),
  source: InputContentSourceSchema,
  metadata: z.unknown().optional(),
});

const LegacyBinaryInputContentObjectSchema = z.object({
  type: z.literal("binary"),
  mimeType: z.string(),
  id: z.string().optional(),
  url: z.string().optional(),
  data: z.string().optional(),
  filename: z.string().optional(),
});

const ensureBinaryPayload = (
  value: z.infer<typeof LegacyBinaryInputContentObjectSchema>,
  ctx: z.RefinementCtx,
) => {
  if (!value.id && !value.url && !value.data) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BinaryInputContent requires at least one of id, url, or data.",
      path: ["id"],
    });
  }
};

const InputContentBaseSchema = z.discriminatedUnion("type", [
  TextInputContentSchema,
  ImageInputContentSchema,
  AudioInputContentSchema,
  VideoInputContentSchema,
  DocumentInputContentSchema,
  LegacyBinaryInputContentObjectSchema,
]);

const InputContentSchema = InputContentBaseSchema.superRefine((value, ctx) => {
  if (value.type === "binary") ensureBinaryPayload(value, ctx);
});

const DeveloperMessageSchema = BaseMessageSchema.extend({
  role: z.literal("developer"),
  content: z.string(),
});

const SystemMessageSchema = BaseMessageSchema.extend({
  role: z.literal("system"),
  content: z.string(),
});

const AssistantMessageSchema = BaseMessageSchema.extend({
  role: z.literal("assistant"),
  content: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
});

const UserMessageSchema = BaseMessageSchema.extend({
  role: z.literal("user"),
  content: z.union([z.string(), z.array(InputContentSchema)]),
});

const ToolMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.literal("tool"),
  toolCallId: z.string(),
  error: z.string().optional(),
  encryptedValue: z.string().optional(),
});

const ActivityMessageSchema = z.object({
  id: z.string(),
  role: z.literal("activity"),
  activityType: z.string(),
  content: z.record(z.any()),
});

const ReasoningMessageSchema = z.object({
  id: z.string(),
  role: z.literal("reasoning"),
  content: z.string(),
  encryptedValue: z.string().optional(),
});

/**
 * AG-UI message union, discriminated on `role`.
 */
export const MessageSchema = z.discriminatedUnion("role", [
  DeveloperMessageSchema,
  SystemMessageSchema,
  AssistantMessageSchema,
  UserMessageSchema,
  ToolMessageSchema,
  ActivityMessageSchema,
  ReasoningMessageSchema,
]);

const BaseEventSchema = z
  .object({
    type: z.nativeEnum(EventType),
    timestamp: z.number().optional(),
    rawEvent: z.any().optional(),
  })
  .passthrough();

/**
 * AG-UI "messages snapshot" event carrying the full conversation state.
 */
export const MessagesSnapshotEventSchema = BaseEventSchema.extend({
  type: z.literal(EventType.MESSAGES_SNAPSHOT),
  messages: z.array(MessageSchema),
});
