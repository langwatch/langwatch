import { z } from "zod";

/**
 * What the AI composer answers with when it turns a sentence into a trace
 * query, or into a saved lens. Lives in the contract because the trace
 * transport publishes it and the search bar reads it.
 */

export const aiQueryResultSchema = z.union([
  z.object({ ok: z.literal(true), query: z.string(), attempts: z.number() }),
  z.object({
    ok: z.literal(false),
    lastQuery: z.string(),
    lastError: z.string(),
    attempts: z.number(),
  }),
]);

export type AiQueryResult = z.infer<typeof aiQueryResultSchema>;

/**
 * The AI's higher-level surface: apply a query to the current view, or
 * create a saved lens, based on user intent ("save as" → `create_lens`).
 */
export const aiActionResultSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal("apply_query"), query: z.string() }),
  z.object({
    ok: z.literal(true),
    kind: z.literal("create_lens"),
    name: z.string(),
    query: z.string(),
  }),
]);

export type AiActionResult = z.infer<typeof aiActionResultSchema>;

/**
 * The operator-actionable fields the composer's "View details" disclosure
 * renders. Stack traces and SDK-internal prefixes are stripped server-side.
 * Travels in `meta`; `AiErrorDetails` is the only named consumer.
 */
export interface AiActionErrorDetails {
  provider?: string;
  model?: string;
  httpStatus?: number;
  /**
   * Why the last attempt failed, in OUR words (the validator's own message).
   * NEVER the provider's raw response text — that can carry a leaked API key.
   */
  reason?: string;
  /** The last query the model produced, when it produced one. */
  lastQuery?: string;
}

/**
 * The composer's view of a failure. Deliberately carries no prose: `code`
 * drives UI branching, `cause` feeds `explainAnyError`, `details` the
 * disclosure.
 */
export type AiActionError = {
  /**
   * The handled code, or `"unknown"`. Typed `string` not `AppErrorCode`: a
   * client can't assume the server enumerates exactly the codes it knows.
   */
  code: string;
  /**
   * The failure as it arrived, so the UI resolves its words through
   * `explainAnyError` rather than rendering a sentence the server chose.
   */
  cause?: unknown;
  /** Optional structured detail rendered in the disclosure. */
  details?: AiActionErrorDetails;
};
