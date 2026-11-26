/**
 * LangWatch Judge (preview) as the scenario judge's chat model: the one non-streamed, OpenAI-shaped
 * call the judge makes, and the tool call it is answered with.
 * @see modules/scenario/specs/judge-preview.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The provider-prefixed id the engine proxy takes, so the judge's client speaks OpenAI's shape. */
export const JUDGE_PREVIEW_LITELLM_MODEL = "openai/langwatch-judge-preview";

/** Where the endpoint lives under the app's base URL; the engine appends `/chat/completions`. */
export const JUDGE_PREVIEW_API_BASE_PATH = "/api/judge-preview/v1";

const judgePreviewChatToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

const judgePreviewChatMessageSchema = z.looseObject({
  role: z.string(),
  /** Text, or content parts whose text is read; a tool call's message carries none. */
  content: z
    .union([z.string(), z.array(z.looseObject({ type: z.string(), text: z.string().optional() }))])
    .nullish(),
});

/** The fields read from the judge's request; any other OpenAI field is accepted and ignored. */
const judgePreviewChatRequestSchemaDefinition = z.looseObject({
  model: z.string().optional(),
  messages: z.array(judgePreviewChatMessageSchema).min(1),
  tools: z.array(judgePreviewChatToolSchema).optional(),
  stream: z.boolean().nullish(),
});
export interface JudgePreviewChatRequestSchema extends Named<
  typeof judgePreviewChatRequestSchemaDefinition
> {}
export const judgePreviewChatRequestSchema: JudgePreviewChatRequestSchema =
  judgePreviewChatRequestSchemaDefinition;
export type JudgePreviewChatRequest = z.infer<typeof judgePreviewChatRequestSchema>;

const judgePreviewChatCompletionSchemaDefinition = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int(),
      finish_reason: z.literal("tool_calls"),
      message: z.object({
        role: z.literal("assistant"),
        content: z.null(),
        tool_calls: z.array(
          z.object({
            id: z.string(),
            type: z.literal("function"),
            function: z.object({ name: z.string(), arguments: z.string() }),
          }),
        ),
      }),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
  }),
});
export interface JudgePreviewChatCompletionSchema extends Named<
  typeof judgePreviewChatCompletionSchemaDefinition
> {}
export const judgePreviewChatCompletionSchema: JudgePreviewChatCompletionSchema =
  judgePreviewChatCompletionSchemaDefinition;
export type JudgePreviewChatCompletion = z.infer<typeof judgePreviewChatCompletionSchema>;

export type JudgePreviewChatInput = Readonly<{
  projectId: string;
  request: JudgePreviewChatRequest;
  /** The caller's disconnect: it stops the judge's routed legs, and what they paid is billed. */
  signal?: AbortSignal;
}>;
