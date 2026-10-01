import { z } from "zod";

const chatRoleSchema = z.union([
  z.literal("system"),
  z.literal("developer"),
  z.literal("user"),
  z.literal("assistant"),
  z.literal("function"),
  z.literal("tool"),
  z.literal("unknown"),
]);

const functionCallSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.string(),
  function: functionCallSchema,
});

const scenarioRichContentSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().optional(),
    content: z.string().optional(),
  }),
  z.object({ text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z
      .object({
        url: z.string(),
        detail: z.union([z.literal("auto"), z.literal("low"), z.literal("high")]).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("tool_call"),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    args: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    result: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("binary"),
    mimeType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
    filename: z.string().optional(),
  }),
  z.object({
    type: z.literal("input_audio"),
    input_audio: z.object({
      data: z.string().optional(),
      format: z.string().optional(),
      url: z.string().optional(),
      mimeType: z.string().optional(),
      id: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("audio"),
    source: z.object({
      type: z.union([z.literal("url"), z.literal("data")]),
      value: z.string(),
      mimeType: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("image"),
    image: z.string(),
    mediaType: z.string().optional(),
  }),
  z.object({
    type: z.literal("file"),
    mediaType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    filename: z.string().optional(),
  }),
  z.object({
    type: z.literal("file"),
    file: z.object({
      file_data: z.string().optional(),
      file_id: z.string().optional(),
      filename: z.string().optional(),
    }),
  }),
]);

/**
 * Portable transcript schema for scenario run events. This is the exact
 * cross-provider wire shape formerly owned by the tracer module; it lives
 * here because scenario-event ingestion is the consumer and owner.
 */
export const scenarioMessageSchema = z.object({
  role: chatRoleSchema.optional(),
  content: z
    .union([z.string(), z.array(scenarioRichContentSchema)])
    .optional()
    .nullable(),
  parts: z.array(scenarioRichContentSchema).optional(),
  function_call: functionCallSchema.optional().nullable(),
  tool_calls: z.array(toolCallSchema).optional().nullable(),
  tool_call_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  reasoning_content: z.string().optional().nullable(),
});
