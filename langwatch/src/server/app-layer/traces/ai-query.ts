import { generateObject, generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { createLogger } from "~/utils/logger";
import { QUERY_SYNTAX_DOC } from "./query-language/grammar";
import { FIELD_VALUES, SEARCH_FIELDS } from "./query-language/metadata";
import { isEmptyAST, parse } from "./query-language/parse";
import { validateAst } from "./query-language/queries";

const logger = createLogger("langwatch:ai-query");

const MAX_ATTEMPTS = 3;
const DYNAMIC_VALUES_LIMIT = 20;

export interface AiQueryInput {
  projectId: string;
  prompt: string;
  timeRange: { from: number; to: number };
}

export type AiQueryResult =
  | { ok: true; query: string; attempts: number }
  | {
      ok: false;
      lastQuery: string;
      lastError: string;
      attempts: number;
    };

/**
 * The AI's higher-level surface — it can either apply a query to the
 * current view, or create a saved lens. The model picks the kind based
 * on the user's intent (phrases like "save as", "view for", "lens for"
 * lean toward `create_lens`; everything else toward `apply_query`).
 */
export type AiActionResult =
  | { ok: true; kind: "apply_query"; query: string }
  | {
      ok: true;
      kind: "create_lens";
      name: string;
      query: string;
    }
  | { ok: false; error: AiActionError };

/**
 * Structured error returned to the UI. The composer renders `message`
 * as the inline badge and pops `details` into a "View details"
 * disclosure on hover/click. Stack traces and SDK-internal prefixes
 * are stripped before this leaves the server — only operator-actionable
 * fields cross the wire.
 */
export type AiActionError = {
  /** Short, user-readable headline. Always set. */
  message: string;
  /** Stable code for UI branching and telemetry. */
  code: "provider_error" | "validation_error" | "unknown";
  /** Optional structured detail rendered in the disclosure. */
  details?: {
    provider?: string;
    model?: string;
    httpStatus?: number;
    /** Cleaned-up provider response text, free of stack traces. */
    reason?: string;
    /** For validation errors, the last query the model produced. */
    lastQuery?: string;
  };
};

const aiActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apply_query"),
    query: z
      .string()
      .describe(
        "The trace query language string to apply to the current view.",
      ),
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
      .describe(
        "The locked filter query for the new lens (same syntax as apply_query).",
      ),
  }),
]);

/**
 * Translate a natural-language description into our trace query language.
 * Calls the project's default LLM with the grammar doc + a snapshot of
 * categorical values, then validates the output. If parse/validate fails,
 * loops up to `MAX_ATTEMPTS` times feeding the error back to the model.
 */
export async function generateTraceQueryFromPrompt(
  input: AiQueryInput,
): Promise<AiQueryResult> {
  const fieldsBlock = await buildFieldsBlock(input);
  const systemPrompt = buildSystemPrompt(fieldsBlock);
  const messages: ModelMessage[] = [{ role: "user", content: input.prompt }];

  const model = await getVercelAIModel({
    projectId: input.projectId,
    featureKey: "traces.ai_search",
  });

  let lastQuery = "";
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text } = await generateText({
      model,
      system: systemPrompt,
      messages,
      temperature: 0,
      maxRetries: 1,
    });
    lastQuery = sanitizeLlmOutput(text);

    const validation = validateQuery(lastQuery);
    if (validation.ok) {
      return { ok: true, query: lastQuery, attempts: attempt };
    }
    lastError = validation.error;
    logger.info(
      { projectId: input.projectId, attempt, lastError, lastQuery },
      "AI query failed validation, retrying",
    );
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `That query failed to parse: ${validation.error}\n\nReturn a valid query. Output ONLY the query, with no quotes, no prose, no leading or trailing punctuation.`,
    });
  }

  return { ok: false, lastQuery, lastError, attempts: MAX_ATTEMPTS };
}

function validateQuery(
  query: string,
): { ok: true } | { ok: false; error: string } {
  if (!query) return { ok: false, error: "Empty query." };
  try {
    const ast = parse(query);
    if (isEmptyAST(ast)) return { ok: false, error: "Empty query." };
    const semanticError = validateAst(ast);
    if (semanticError) return { ok: false, error: semanticError };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown parse error.",
    };
  }
}

/**
 * Strip artifacts that LLMs often emit even when told not to: code fences,
 * leading "query:" labels, surrounding quotes, trailing periods.
 */
function sanitizeLlmOutput(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  out = out.replace(/^(?:query|filter|q)\s*[:=]\s*/i, "");
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

/**
 * Higher-level entry point: lets the model choose between just filtering
 * the current view (`apply_query`) and creating a named lens
 * (`create_lens`). Returns a structured action the frontend dispatches.
 *
 * Validates the embedded query the same way `generateTraceQueryFromPrompt`
 * does, retrying on parse failure.
 */
export async function generateTraceAction(
  input: AiQueryInput,
): Promise<AiActionResult> {
  const fieldsBlock = await buildFieldsBlock(input);
  const systemPrompt = buildActionSystemPrompt(fieldsBlock);

  const model = await getVercelAIModel({
    projectId: input.projectId,
    featureKey: "traces.ai_search",
  });

  let lastError = "Unknown error";
  let lastQuery = "";
  // Track only the *last* attempt's failure kind so the UI message
  // matches what actually happened on the final try. A transient
  // provider blip on attempt 1 followed by a validation failure on
  // attempt 2 should surface as "couldn't parse the query," not
  // "provider error."
  let lastFailure: "provider" | "validation" | null = null;
  let lastProviderError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let parsedAction: z.infer<typeof aiActionSchema>;
    try {
      const { object } = await generateObject({
        model,
        schemaName: "TraceAction",
        schemaDescription:
          "Either an apply_query (filter the current view) or a create_lens (create a saved view) action with a trace query language string.",
        schema: aiActionSchema,
        // Only inject the retry-context blurb when the previous failure
        // was a parse/validation issue. After a provider/SDK throw,
        // `lastQuery` is "" and `lastError` is a stack-y SDK message —
        // splicing those into a "previous attempt produced query X
        // which failed to parse: Y" sentence misleads the model into
        // thinking it produced an empty query that won't parse.
        system:
          attempt === 1 || lastFailure !== "validation"
            ? systemPrompt
            : `${systemPrompt}\n\nThe previous attempt produced query "${lastQuery}" which failed to parse: ${lastError}\nReturn a valid query this time.`,
        prompt: input.prompt,
        maxRetries: 1,
      });
      parsedAction = object;
    } catch (e) {
      lastFailure = "provider";
      lastProviderError = e;
      lastError = e instanceof Error ? e.message : "Unknown generation error.";
      logger.error(
        { projectId: input.projectId, attempt, lastError, err: e },
        "AI action generation failed",
      );
      continue;
    }

    lastQuery = parsedAction.query;
    const validation = validateQuery(parsedAction.query);
    if (validation.ok) {
      return parsedAction.kind === "apply_query"
        ? { ok: true, kind: "apply_query", query: parsedAction.query }
        : {
            ok: true,
            kind: "create_lens",
            name: parsedAction.name,
            query: parsedAction.query,
          };
    }
    lastFailure = "validation";
    lastError = validation.error;
    logger.info(
      { projectId: input.projectId, attempt, lastError, lastQuery },
      "AI action query failed validation, retrying",
    );
  }

  // Don't leak raw SDK exception messages — those carry stack-y prefixes
  // like "litellm.BadRequestError: OpenAIException - …" plus traces.
  // `summarizeProviderError` extracts the operator-actionable fields
  // (provider, model, http status, reason) and lets the composer render
  // a polished one-liner + a "View details" disclosure with the rest.
  if (lastFailure === "provider") {
    return {
      ok: false,
      error: summarizeProviderError(lastProviderError),
    };
  }
  return {
    ok: false,
    error: {
      code: "validation_error",
      message:
        "AI's reply didn't match the trace query syntax. Try rephrasing.",
      details: { reason: lastError, lastQuery },
    },
  };
}

/**
 * Curate an SDK/provider exception into the operator-actionable fields
 * the UI renders in the AI-search composer. Strips stack traces and
 * `litellm.XYZException` prefixes; pulls out HTTP status, provider key,
 * referenced model id, and the human-readable `'message'` substring
 * embedded in the JSON-shaped body LiteLLM forwards from providers.
 *
 * Never throws — anything we can't parse falls through to a truncated
 * raw-cleaned text so we still produce *something* for the operator
 * instead of a vacant "Unknown error" badge.
 */
function summarizeProviderError(err: unknown): AiActionError {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const cleaned = raw
    .split("\n")
    .filter((line) => !/^\s*at\s+/.test(line))
    .join("\n")
    .trim();

  const statusMatch =
    cleaned.match(/status[_\s]*code[:\s]+(\d{3})/i) ??
    cleaned.match(/\b(?:HTTP\s+)?(\d{3})\b/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;

  const providerMatch = cleaned.match(
    /(?:litellm\.|\b)(OpenAI|Azure|Anthropic|Gemini|Google|Cohere|Mistral|Groq|Together|Bedrock|Vertex)(?:Exception|Error|APIError)/i,
  );
  const provider = providerMatch ? providerMatch[1].toLowerCase() : undefined;

  const modelMatch =
    cleaned.match(
      /model\s+["']?([\w./:-]+)["']?\s+(?:does\s+not\s+exist|not\s+found|is\s+invalid)/i,
    ) ?? cleaned.match(/Unknown\s+model[:\s]+([\w./:-]+)/i);
  const model = modelMatch ? modelMatch[1] : undefined;

  const reasonMatch =
    cleaned.match(/['"]message['"][:\s]+['"]([^'"]{1,300})['"]/) ??
    cleaned.match(/['"]error['"][:\s]+['"]([^'"]{1,300})['"]/);
  const reason = reasonMatch?.[1];

  let message = "Couldn't reach the model provider";
  if (httpStatus && reason) {
    message = `Provider returned ${httpStatus}: ${reason}`;
  } else if (httpStatus) {
    message = `Provider returned ${httpStatus}`;
  } else if (reason) {
    message = reason;
  } else if (cleaned) {
    const firstLine = cleaned.split("\n")[0]?.trim() ?? "";
    if (firstLine) message = firstLine.slice(0, 200);
  }

  return {
    code: "provider_error",
    message,
    details: {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(httpStatus ? { httpStatus } : {}),
      ...(reason ? { reason } : {}),
    },
  };
}

function buildActionSystemPrompt(fieldsBlock: string): string {
  return `You are an expert at translating LangWatch operators' natural-language
requests into a trace-view action. The operator is looking at a list of
LLM traces (every API call to their AI app) and wants to either filter
the current view or save a new view they can come back to. Your reply
is a JSON object matching the \`TraceAction\` schema — nothing else.

# Pick the action kind

1. **\`apply_query\`** — filter the current view. This is the default;
   use it for anything that reads like "show / find / list / give me /
   how many / which traces…". Examples of intent:
   - "show me errors today"
   - "slow GPT-4 calls"
   - "traces with feedback"

2. **\`create_lens\`** — create a NEW persistent saved view with this
   filter baked in. Use this only when the operator clearly wants a
   reusable surface, not a one-off filter. Trigger phrases include
   "save as / save this / create a view / make a lens / pin this /
   I want a tab for / set up a lens for". For create_lens, also
   produce a 1-3 word Title Case lens name (no quotes, no
   punctuation).

When the phrasing is ambiguous, prefer \`apply_query\`. It's cheap to
redo; \`create_lens\` adds a tab to the operator's workspace and is
the more disruptive default.

# Build the query

The \`query\` field on either action holds a string in the LangWatch
trace query language:

${QUERY_SYNTAX_DOC}

## Fields available (with sample values)

${fieldsBlock}

# Hard rules

- **Field discipline.** Use ONLY the fields listed above. If the
  operator mentions an attribute that doesn't appear in the catalog,
  drop it rather than guess a field name. Better to under-filter than
  to introduce a clause that won't parse.
- **Time window.** The view already has a time-range selector outside
  this filter. Do NOT include date or time clauses unless the operator
  explicitly asks for a specific timestamp range — phrases like
  "today", "the last hour", "this week" map onto the existing time
  selector and should not appear in your query.
- **Uppercase booleans.** AND, OR, NOT must be uppercase.
- **Value-side OR.** Group with parens: \`status:(error OR warning)\`.
- **Wildcards.** Use \`*\`, e.g. \`model:gpt-4*\`.
- **Numeric ranges.** Use \`[low TO high]\` (inclusive) or comparison
  operators (\`>\`, \`>=\`, \`<\`, \`<=\`). Never write words like
  "between" or "to" outside the bracket form.
- **Free text.** Quote multi-word free text: \`"refund policy"\`.
  Single words may be unquoted.
- **No code fences, no prose, no extra JSON fields.**

# Few-shot examples

User: "show me errors"
→ \`{"kind":"apply_query","query":"status:error"}\`

User: "find traces from gpt-4 that took more than 5 seconds"
→ \`{"kind":"apply_query","query":"model:gpt-4* AND duration:>5000"}\`

User: "errors or warnings in the finance service"
→ \`{"kind":"apply_query","query":"status:(error OR warning) AND service:finance"}\`

User: "everything except simulations"
→ \`{"kind":"apply_query","query":"NOT origin:simulation"}\`

User: "save this view as Costly GPT-4"
→ \`{"kind":"create_lens","name":"Costly GPT-4","query":"model:gpt-4* AND cost:>0.5"}\`

User: "make a lens for high-cost calls"
→ \`{"kind":"create_lens","name":"High Cost","query":"cost:>1"}\`

User: "pin a view of negative feedback"
→ \`{"kind":"create_lens","name":"Negative Feedback","query":"feedback:negative"}\`

User: "good ones"  (vague — can't be expressed)
→ \`{"kind":"apply_query","query":""}\`

User: "weather in Tokyo"  (off-topic)
→ \`{"kind":"apply_query","query":""}\`

# Escape hatch

If the request is genuinely ambiguous, off-topic, or asks for
something the query language can't express, return
\`{"kind":"apply_query","query":""}\`. The caller treats an empty
query as a no-op and shows the operator a gentle "couldn't translate"
hint — much better than a hallucinated filter.`;
}

function buildSystemPrompt(fieldsBlock: string): string {
  return `You are an expert at translating LangWatch operators' natural-language
requests into our trace query language. The operator is looking at a
list of LLM traces and wants to filter it. Your output is a single
query string that the caller will run against the trace store —
nothing else.

# How to think about this

1. Identify the structured concepts in the request (status, model,
   service, latency, cost, tokens, evaluator results, etc.) and map
   each one onto a field in the catalog below.
2. Decide which clauses are conjunctions (AND) and which are
   alternations (OR or CSV shorthand inside a field).
3. Emit the query string. Nothing else.

${QUERY_SYNTAX_DOC}

## Fields available (with sample values)

${fieldsBlock}

# Hard rules

- **Output ONLY the query string.** No prose, no quotes around the
  whole thing, no labels (\`query:\`), no code fences.
- **Field discipline.** Use ONLY the fields listed in the catalog.
  Never invent fields. If a concept has no matching field, drop it
  rather than guess.
- **Time window.** The view already has a time-range selector outside
  this query. Do NOT include date or time clauses — "today", "last
  hour", "this week" map onto the existing time selector.
- **Uppercase AND / OR / NOT.**
- **Value-side OR** groups with parens: \`status:(error OR warning)\`.
- **Wildcards** use \`*\`.
- **Numeric ranges** use \`[low TO high]\` or comparisons
  (\`>\`, \`>=\`, \`<\`, \`<=\`).
- **Free text** is quoted if multi-word: \`"refund policy"\`.

# Few-shot examples

"show me errors" → \`status:error\`
"find gpt-4 calls over 5 seconds" → \`model:gpt-4* AND duration:>5000\`
"errors or warnings in finance" → \`status:(error OR warning) AND service:finance\`
"everything except simulations" → \`NOT origin:simulation\`
"high cost calls" → \`cost:>1\`
"traces mentioning refund policy" → \`"refund policy"\`
"good ones" (vague) → (empty string)

# Escape hatch

If the request is genuinely ambiguous, off-topic, or unexpressible in
the query language, output an empty string. An empty string is a
legitimate, polite "I couldn't translate that"; hallucinating a filter
the operator didn't ask for is worse.`;
}

async function buildFieldsBlock(input: AiQueryInput): Promise<string> {
  const dynamicValues = await fetchDynamicCategoricalValues(input);
  const lines: string[] = [];
  for (const [name, meta] of Object.entries(SEARCH_FIELDS)) {
    const sample = pickSampleValues(name, meta.facetField, dynamicValues);
    const sampleStr = sample.length > 0 ? ` — e.g. ${sample.join(", ")}` : "";
    lines.push(`- ${name} (${meta.valueType}): ${meta.label}${sampleStr}`);
  }
  return lines.join("\n");
}

function pickSampleValues(
  fieldName: string,
  facetField: string | undefined,
  dynamic: Map<string, string[]>,
): string[] {
  const fromDb = facetField ? (dynamic.get(facetField) ?? []) : [];
  const fromStatic = FIELD_VALUES[fieldName] ?? [];
  const merged = Array.from(new Set([...fromDb, ...fromStatic])).slice(0, 8);
  return merged;
}

async function fetchDynamicCategoricalValues(
  input: AiQueryInput,
): Promise<Map<string, string[]>> {
  const app = getApp();
  const facetFields = Object.values(SEARCH_FIELDS)
    .filter((meta) => meta.valueType === "categorical" && meta.facetField)
    .map((meta) => meta.facetField as string);

  const results = await Promise.allSettled(
    facetFields.map((facetKey) =>
      app.traces.list.getFacetValues({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        facetKey,
        limit: DYNAMIC_VALUES_LIMIT,
        offset: 0,
      }),
    ),
  );

  const map = new Map<string, string[]>();
  results.forEach((result, idx) => {
    const facetKey = facetFields[idx];
    if (!facetKey) return;
    if (result.status === "fulfilled") {
      map.set(
        facetKey,
        result.value.values.map((v) => v.value),
      );
    }
  });
  return map;
}
