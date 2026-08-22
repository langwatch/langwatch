/**
 * Agent message wire schemas — the message dialect the scenario SDK speaks.
 *
 * Vendored from `@ag-ui/core@0.0.57` (`MessageSchema` and the content-part
 * chain beneath it), which this file replaces as a dependency.
 *
 * ## Why vendored rather than imported
 *
 * The package exports ~90 schemas covering the whole AG-UI protocol — agent
 * capabilities, run lifecycle, state deltas, transports. We used exactly one
 * of them, and paid for it with 442 KB of generated `.d.ts` on every typecheck
 * and a hard `zod@^3` pin on a file the rest of the tree is moving past.
 *
 * ## Why this is still a contract, not just our types
 *
 * These shapes are what `@langwatch/scenario` puts on the wire, and that SDK
 * ships to users we do not control. Changing a field here does not change what
 * arrives — it changes whether what arrives is understood. Treat every field
 * as load-bearing until the wire stops carrying it.
 *
 * Note the published SDK currently pins `@ag-ui/core@0.0.28`, which has five
 * message roles; `activity` and `reasoning` below arrived in later versions and
 * are accepted here ahead of any client that emits them.
 *
 * ## Casing
 *
 * `toolCalls` / `toolCallId` are camelCase here and snake_case in
 * `chatMessageSchema` (OpenAI's dialect). Both spellings reach the ingest
 * endpoint and both are accepted; nothing normalises between them, so readers
 * accept both too — see `readToolCalls` in `components/conversation/flattenMessages.ts`.
 *
 * @see specs/scenarios/scenario-message-wire-contract.feature
 * @see https://github.com/ag-ui-protocol/ag-ui
 */
import { z } from "zod";

const functionCallSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: functionCallSchema,
  encryptedValue: z.string().optional(),
});

const baseMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string().optional(),
  name: z.string().optional(),
  encryptedValue: z.string().optional(),
});

const inputContentDataSourceSchema = z.object({
  type: z.literal("data"),
  value: z.string(),
  mimeType: z.string(),
});

const inputContentUrlSourceSchema = z.object({
  type: z.literal("url"),
  value: z.string(),
  mimeType: z.string().optional(),
});

const inputContentSourceSchema = z.discriminatedUnion("type", [
  inputContentDataSourceSchema,
  inputContentUrlSourceSchema,
]);

const textInputContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/** Image, audio, video and document parts differ only in their discriminator. */
const mediaInputContentSchema = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    source: inputContentSourceSchema,
    metadata: z.unknown().optional(),
  });

/**
 * The pre-`source` binary part, kept because clients still send it.
 *
 * Every payload field is optional individually, so the refinement below is what
 * enforces that at least one of them carries the bytes. It lives outside the
 * union member because `z.discriminatedUnion` rejects effect-wrapped members —
 * hence the plain object here and the refinement applied to the union.
 */
const binaryInputContentSchema = z.object({
  type: z.literal("binary"),
  mimeType: z.string(),
  id: z.string().optional(),
  url: z.string().optional(),
  data: z.string().optional(),
  filename: z.string().optional(),
});

const requireBinaryPayload = (
  value: z.infer<typeof binaryInputContentSchema>,
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

const inputContentSchema = z
  .discriminatedUnion("type", [
    textInputContentSchema,
    mediaInputContentSchema("image"),
    mediaInputContentSchema("audio"),
    mediaInputContentSchema("video"),
    mediaInputContentSchema("document"),
    binaryInputContentSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.type === "binary") requireBinaryPayload(value, ctx);
  });

const developerMessageSchema = baseMessageSchema.extend({
  role: z.literal("developer"),
  content: z.string(),
});

const systemMessageSchema = baseMessageSchema.extend({
  role: z.literal("system"),
  content: z.string(),
});

const assistantMessageSchema = baseMessageSchema.extend({
  role: z.literal("assistant"),
  content: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
});

const userMessageSchema = baseMessageSchema.extend({
  role: z.literal("user"),
  content: z.union([z.string(), z.array(inputContentSchema)]),
});

const toolMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.literal("tool"),
  toolCallId: z.string(),
  error: z.string().optional(),
  encryptedValue: z.string().optional(),
});

const activityMessageSchema = z.object({
  id: z.string(),
  role: z.literal("activity"),
  activityType: z.string(),
  content: z.record(z.any()),
});

const reasoningMessageSchema = z.object({
  id: z.string(),
  role: z.literal("reasoning"),
  content: z.string(),
  encryptedValue: z.string().optional(),
});

/**
 * A single message in the agent dialect, discriminated on `role`.
 *
 * Every member requires `id`. Messages without one fall through to
 * `chatMessageSchema` in the ingest union, which is why an id-less message is
 * still accepted — see the wire-contract spec.
 */
export const agentMessageSchema = z.discriminatedUnion("role", [
  developerMessageSchema,
  systemMessageSchema,
  assistantMessageSchema,
  userMessageSchema,
  toolMessageSchema,
  activityMessageSchema,
  reasoningMessageSchema,
]);

export type AgentMessage = z.infer<typeof agentMessageSchema>;
