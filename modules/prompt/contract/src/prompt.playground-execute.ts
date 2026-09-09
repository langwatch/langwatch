/**
 * The wire contract between the playground UI and its execution endpoint.
 *
 * Framework-free on purpose: the browser imports the endpoint path and event
 * type, the server route imports the request schema, and neither drags the
 * other's world along. The version is spelled in the path the client calls —
 * there is no unversioned way to reach the endpoint worth teaching the client
 * ([ADR-112 direction]: omitting a version must never silently mean "latest").
 */
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
 * `workflow` (or any other unexpected key) is a malformed request, not an
 * ignorable extra. Stripping it silently would let a client believe its
 * workflow was executed.
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
 * One event on the playground's stream.
 *
 * A closed set, rather than the previous arrangement where a failure was a text
 * message whose content began with the literal string `[ERROR]` and the client
 * string-matched it back apart.
 */
export type PlaygroundStreamEvent =
  | { type: "start"; messageId: string; traceId: string }
  | { type: "delta"; content: string }
  | { type: "error"; error: ParsedLLMError }
  | { type: "done" };
