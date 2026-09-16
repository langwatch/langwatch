/** Wire contract between playground UI and execution endpoint (framework-free; versioned path). */
import { z } from "zod";

import { runtimeInputsSchema } from "./prompt.field-schemas.ts";
import { formSchema } from "./prompt.form-schema.ts";
import type { ParsedLLMError } from "./prompt.llm-error.ts";

export const PLAYGROUND_API_VERSION = "2026-08-20";

export const PROMPT_PLAYGROUND_BASE_PATH = "/api/prompt-playground";

export const PROMPT_EXECUTE_PATH = `/${PLAYGROUND_API_VERSION}/prompt.execute`;

export const PROMPT_EXECUTE_ENDPOINT = `${PROMPT_PLAYGROUND_BASE_PATH}${PROMPT_EXECUTE_PATH}`;

/**
 * Strict: the endpoint builds the workflow server-side, so a caller-supplied
 * `workflow` key is malformed, not an ignorable extra - stripping it silently
 * would let a client believe its workflow was executed.
 */
export const executeRequestSchema = z
  .object({
    projectId: z.string().min(1).max(64),
    formValues: formSchema,
    variables: runtimeInputsSchema.default([]),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).default([]),
    threadId: z.string().optional(),
  })
  .strict();

export type PromptExecuteRequest = z.infer<typeof executeRequestSchema>;

/**
 * One event on the playground's stream - a closed set, rather than a text
 * message whose content began with the literal string `[ERROR]` for the
 * client to string-match back apart.
 */
export type PlaygroundStreamEvent =
  | { type: "start"; messageId: string; traceId: string }
  | { type: "delta"; content: string }
  | { type: "error"; error: ParsedLLMError }
  | { type: "done" };
