/**
 * How the AI trace-query composer reads what the model answered: the shapes it
 * asks for, the clean-up and validation of a query it wrote, and the curated
 * fields a provider failure may surface. Ported from main's ai-query.ts.
 */

import {
  type AiActionErrorDetails,
  describeAstProblem,
  isEmptyAST,
  parse,
} from "@langwatch/trace-contract";
import { z } from "zod";

export const MAX_ATTEMPTS = 3;

export const aiActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apply_query"),
    query: z.string().describe("The trace query language string to apply to the current view."),
  }),
  z.object({
    kind: z.literal("create_lens"),
    name: z
      .string()
      .min(1)
      .max(60)
      .describe("Short human-readable lens name (1-3 words). Use Title Case."),
    query: z
      .string()
      .describe("The locked filter query for the new lens (same syntax as apply_query)."),
  }),
]);

export const instantEvalQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    instructions: z
      .string()
      .min(1)
      .max(600)
      .describe(
        "The judge question, one or two sentences, asked of a single trace or conversation.",
      ),
    yes: z.string().min(1).max(300).describe("What a yes looks like in the text being judged."),
    no: z.string().min(1).max(300).describe("What a no looks like in the text being judged."),
  }),
  z.object({
    kind: z.literal("filter"),
    query: z
      .string()
      .min(1)
      .describe("A trace query using an evaluator or event the project already has."),
    reason: z
      .string()
      .min(1)
      .max(200)
      .describe("One sentence naming the evaluator or event that answers it."),
  }),
]);

export const searchRouteSchema = z.discriminatedUnion("route", [
  z.object({
    route: z.literal("filter"),
    query: z.string().describe("The trace query language string that expresses the sentence."),
  }),
  z.object({
    route: z.literal("instant_eval"),
    instructions: z.string().min(1).max(600),
    yes: z.string().min(1).max(300),
    no: z.string().min(1).max(300),
  }),
  z.object({ route: z.literal("free_text") }),
  z.object({ route: z.literal("langy") }),
]);

/** The query the previous attempt wrote and why it did not parse. */
export type QueryRetry = { lastQuery: string; lastError: string };

export function validateQuery(query: string): { ok: true } | { ok: false; error: string } {
  if (!query) return { ok: false, error: "Empty query." };
  try {
    const ast = parse(query);
    if (isEmptyAST(ast)) return { ok: false, error: "Empty query." };
    const semanticError = describeAstProblem(ast);
    if (semanticError) return { ok: false, error: semanticError };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown parse error." };
  }
}

/** Strips code fences, `query:` labels, surrounding quotes: what models emit when told not to. */
export function sanitizeLlmOutput(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  out = out.replace(/^(?:query|filter|q)\s*[:=]\s*/i, "");
  const first = out.at(0);
  if (first === out.at(-1) && (first === '"' || first === "'")) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

/** The system prompt, with the previous parse failure appended on a retry. */
export function withRetryNote({
  systemPrompt,
  retry,
}: {
  systemPrompt: string;
  retry: QueryRetry | null;
}): string {
  if (!retry) return systemPrompt;
  return `${systemPrompt}\n\nThe previous attempt produced query "${retry.lastQuery}" which failed to parse: ${retry.lastError}\nReturn a valid query this time.`;
}

/**
 * Curates a provider exception into the disclosure's fields: status, vendor
 * from a fixed list, model id. Never the provider's prose: a rejected key's
 * `message` is the credential itself (main: ai-query.summarize-provider-error).
 */
export function summarizeProviderError(
  err: unknown,
  context?: { model?: string },
): AiActionErrorDetails {
  let raw = "";
  if (err instanceof Error) raw = err.message;
  else if (typeof err === "string" || typeof err === "number") raw = String(err);
  const cleaned = raw
    .split("\n")
    .filter((line) => !/^\s*at\s+/.test(line))
    .join("\n")
    .trim();

  const statusMatch =
    cleaned.match(/status[_\s]*code[:\s]+(\d{3})/i) ?? cleaned.match(/\b(?:HTTP\s+)?(\d{3})\b/);
  const structuredStatus =
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof err.statusCode === "number"
      ? err.statusCode
      : undefined;
  const httpStatus = structuredStatus ?? (statusMatch ? Number(statusMatch[1]) : undefined);

  const providerMatch = cleaned.match(
    /(?:litellm\.|\b)(OpenAI|Azure|Anthropic|Gemini|Google|Cohere|Mistral|Groq|Together|Bedrock|Vertex)(?:Exception|Error|APIError)/i,
  );
  const provider = providerMatch?.[1]?.toLowerCase() ?? context?.model?.split("/")[0];

  const modelMatch =
    cleaned.match(
      /model\s+["']?([\w./:-]+)["']?\s+(?:does\s+not\s+exist|not\s+found|is\s+invalid)/i,
    ) ?? cleaned.match(/Unknown\s+model[:\s]+([\w./:-]+)/i);
  const model = modelMatch ? modelMatch[1] : context?.model;

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(httpStatus ? { httpStatus } : {}),
  };
}

/** What a provider failure may put in the log: the curated fields, none of its text. */
export function providerErrorLogPayload({
  projectId,
  attempt,
  error,
}: {
  projectId: string;
  attempt?: number;
  error: unknown;
}): { projectId: string; attempt?: number; providerError: AiActionErrorDetails } {
  return {
    projectId,
    ...(attempt === undefined ? {} : { attempt }),
    providerError: summarizeProviderError(error),
  };
}
