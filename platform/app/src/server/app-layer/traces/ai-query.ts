import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  isEmptyAST,
  parse,
  QUERY_SYNTAX_DOC,
  type TraceService,
  validateAst,
} from "@langwatch/trace-contract";
import { generateObject, generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { getVercelAIModel } from "~/server/modelProviders/utils";

const logger = createLogger("langwatch:ai-query");

const MAX_ATTEMPTS = 3;
export interface AiQueryInput {
  projectId: string;
  prompt: string;
  timeRange: { from: number; to: number };
  modelProviders: ModelProviderService;
  managedProviders: ManagedProviderService;
  traces: TraceService;
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
    };

/**
 * The operator-actionable fields the composer's "View details" disclosure
 * renders. Stack traces and SDK-internal prefixes are stripped before any of
 * this leaves the server.
 *
 * This is the whole reason these travel in `meta`: `AiErrorDetails`
 * (`features/traces-v2/components/SearchBar/ErrorBannerDetail.tsx`) is the
 * named consumer. Nothing else reads them.
 */
export interface AiActionErrorDetails {
  provider?: string;
  model?: string;
  httpStatus?: number;
  /**
   * Why the last attempt failed, in OUR words — the query validator's own
   * message ("unexpected token at position 12"), set only on the validation
   * exit below.
   *
   * Never the provider's response text. `summarizeProviderError` used to fill
   * this by regexing `"message"` out of the failure body, which is the field
   * an OpenAI 401 fills with `Incorrect API key provided: sk-proj-…` — our own
   * key, on a managed provider. The structured fields around it carry the
   * operator-actionable part of a provider failure without any of that risk.
   */
  reason?: string;
  /** The last query the model produced, when it produced one. */
  lastQuery?: string;
}

/**
 * Raised when the AI composer could not turn a prompt into a usable trace
 * query — the provider threw on every attempt, or every attempt produced
 * something that would not parse.
 *
 * Its code is `ai_query_provider_error`, which exists precisely so this
 * surface stops minting its own. The old shape declared
 * `"provider_error" | "validation_error" | "unknown"` — a private code system
 * whose values collide with real registry codes carrying copy that does not
 * apply here ("Check your input" for a model that wrote a bad filter) — plus a
 * free-text `message` built from the SDK's own exception and rendered
 * verbatim. The words a customer reads now come from the registry entry for
 * this code, and nowhere else.
 *
 * `fault` is `provider`: the model was asked and did not answer usably.
 */
export class AiQueryProviderError extends HandledError {
  declare readonly code: "ai_query_provider_error";

  constructor(details: AiActionErrorDetails = {}) {
    super("ai_query_provider_error", "The model did not produce a usable trace query.", {
      httpStatus: 502,
      fault: "provider",
      meta: { ...details },
    });
    this.name = "AiQueryProviderError";
  }
}

/**
 * The composer's view of a failure, assembled client-side from whatever
 * arrived. Deliberately carries no prose: `code` selects the registry copy and
 * drives UI branching, `cause` is the error itself so the renderer can call
 * `explainAnyError`, and `details` feeds the disclosure.
 */
export type AiActionError = {
  /**
   * The handled code the failure carried, or `"unknown"` when it carried
   * none. Stable enough to branch and report on.
   *
   * Typed `string` rather than `AppErrorCode` on purpose: it is lifted off the
   * wire, and a client cannot assume the server it is talking to enumerates
   * exactly the codes it knows. An unrecognised one degrades in
   * `explainAnyError` rather than being a type error here.
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

const aiActionSchema = z.discriminatedUnion("kind", [
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

/**
 * Translate a natural-language description into our trace query language.
 * Calls the project's default LLM with the grammar doc + a snapshot of
 * categorical values, then validates the output. If parse/validate fails,
 * loops up to `MAX_ATTEMPTS` times feeding the error back to the model.
 */
export async function generateTraceQueryFromPrompt(input: AiQueryInput): Promise<AiQueryResult> {
  const fieldsBlock = await input.traces.buildQueryFieldCatalogue({
    projectId: input.projectId,
    timeRange: input.timeRange,
  });
  const systemPrompt = buildSystemPrompt(fieldsBlock);
  const messages: ModelMessage[] = [{ role: "user", content: input.prompt }];

  const model = await getVercelAIModel({
    projectId: input.projectId,
    featureKey: "traces.ai_search",
    modelProviders: input.modelProviders,
    managedProviders: input.managedProviders,
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

function validateQuery(query: string): { ok: true } | { ok: false; error: string } {
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
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
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
 * does, retrying on parse failure. Raises {@link AiQueryProviderError} when
 * every attempt is exhausted — the failure travels the handled channel like
 * any other, rather than as an in-band `{ ok: false }` payload the UI had to
 * know how to word.
 */
export async function generateTraceAction(input: AiQueryInput): Promise<AiActionResult> {
  const fieldsBlock = await input.traces.buildQueryFieldCatalogue({
    projectId: input.projectId,
    timeRange: input.timeRange,
  });
  const systemPrompt = buildActionSystemPrompt(fieldsBlock);

  const model = await getVercelAIModel({
    projectId: input.projectId,
    featureKey: "traces.ai_search",
    modelProviders: input.modelProviders,
    managedProviders: input.managedProviders,
  });

  let lastError = "Unknown error";
  let lastQuery = "";
  // Track only the *last* attempt's failure kind so the detail rows describe
  // what actually happened on the final try. A transient provider blip on
  // attempt 1 followed by a validation failure on attempt 2 should show the
  // unparseable query, not a stale HTTP status.
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
  // like "litellm.BadRequestError: OpenAIException - …" plus traces, and for a
  // rejected key the provider's body is the credential itself.
  // `summarizeProviderError` extracts the operator-actionable fields
  // (provider, model, http status) for the "View details" disclosure; the
  // headline the customer reads comes from the registry entry for
  // `ai_query_provider_error`.
  //
  // The validation exit passes a `reason` and the provider exit does not, which
  // is the whole distinction: on that path the sentence is `validateQuery`'s,
  // written here for a query WE parsed, with no provider body anywhere near it.
  //
  // Both exits raise the same code on purpose. From where the customer sits
  // there is one failure — the model didn't give us something we could search
  // with — and its remediation ("rephrase, or pick a different model") is the
  // same whether the provider threw or the reply wouldn't parse.
  throw new AiQueryProviderError(
    lastFailure === "provider"
      ? summarizeProviderError(lastProviderError, { model: model.modelId })
      : { reason: lastError, lastQuery },
  );
}

/**
 * Curate an SDK/provider exception into the operator-actionable fields
 * the UI renders in the AI-search composer's "View details" disclosure.
 * Prefers the structured `statusCode` the AI SDK's APICallError carries and
 * falls back to text extraction: strips stack traces and `litellm.XYZException`
 * prefixes; pulls out HTTP status, provider key and referenced model id.
 *
 * Everything it returns is a value from a known set — a status code, one of a
 * fixed list of vendor names, a model id. It deliberately extracts no prose:
 * see the note at the return.
 *
 * `context.model` is the model the backend actually resolved for the
 * call — provider errors like Azure's bare "Resource not found" carry
 * no model of their own, and the operator can't act on the failure
 * without knowing which configured model to go fix.
 *
 * Never throws, and never produces a headline: it used to compose one
 * ("Provider returned 404 for azure/gpt-5: …"), which put the provider's own
 * sentence on the customer's screen as if we had written it. The headline is
 * the registry's job now; this function only fills the disclosure.
 */
export function summarizeProviderError(
  err: unknown,
  context?: { model?: string },
): AiActionErrorDetails {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const cleaned = raw
    .split("\n")
    .filter((line) => !/^\s*at\s+/.test(line))
    .join("\n")
    .trim();

  // `statusCode` only. The AI SDK's APICallError also carries `responseBody`,
  // which is the provider's raw failure body — it was read here to mine a
  // message out of, and there is nothing else in it we want.
  const structured = err as { statusCode?: unknown } | null | undefined;
  const structuredStatus =
    typeof structured?.statusCode === "number" ? structured.statusCode : undefined;

  const statusMatch =
    cleaned.match(/status[_\s]*code[:\s]+(\d{3})/i) ?? cleaned.match(/\b(?:HTTP\s+)?(\d{3})\b/);
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

  // No `reason` on this exit, deliberately.
  //
  // It used to be pulled straight out of the failure body with
  // `/['"]message['"][:\s]+['"](…)['"]/`, falling back to the first line of the
  // exception. Both land on the provider's own sentence, and `"message"` is
  // exactly the field OpenAI answers a rejected key with: `Incorrect API key
  // provided: sk-proj-…`. On a LangWatch-managed provider that key is OURS, so
  // the disclosure was one 401 away from printing a platform credential — and
  // masking it after the fact only works for credential shapes someone thought
  // to enumerate.
  //
  // The fields kept below are the operator-actionable ones and none of them is
  // free text: a status code, a provider key matched against a fixed list of
  // vendors, a model id. They say which configured model to go fix, which is
  // what the disclosure is for. The words stay the registry's, keyed by
  // `ai_query_provider_error`.
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(httpStatus ? { httpStatus } : {}),
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
