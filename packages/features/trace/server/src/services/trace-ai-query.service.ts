import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  isEmptyAST,
  parse,
  type AiActionErrorDetails,
  type AiActionResult,
  type AiQueryResult,
  type TraceService,
  validateAst,
} from "@langwatch/trace-contract";
import { generateObject, generateText, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { buildActionSystemPrompt, buildSystemPrompt } from "../rules/trace-ai-query-prompt.rules.ts";

const logger = createLogger("langwatch:ai-query");

/**
 * The resolved model's id, for the provider-failure summary. LanguageModel is a union of a model id
 * and a model object, so the id is read off whichever arrived. Diagnostic copy, never a decision.
 */
function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

const MAX_ATTEMPTS = 3;

/** What the retry loop carries between attempts, so the final failure describes the last try. */
interface AiActionAttemptState {
  lastError: string;
  lastQuery: string;
  lastFailure: "provider" | "validation" | null;
  lastProviderError: unknown;
}
/**
 * Resolving the model this feature's calls run on. A port, because the resolution cascade belongs
 * to the model-provider feature and a feature package may not reach into another's server package.
 * The composition root holds both and joins them, so this resolves like every other feature key.
 */
export type AiQueryModelResolver = (input: {
  projectId: string;
  featureKey: string;
}) => Promise<LanguageModel>;

export interface AiQueryInput {
  projectId: string;
  prompt: string;
  timeRange: { from: number; to: number };
  resolveModel: AiQueryModelResolver;
  traces: TraceService;
}

/**
 * Raised when the AI composer could not turn a prompt into a usable trace query: the provider threw
 * on every attempt, or every attempt produced something unparseable. The words a customer reads
 * come from the registry entry for this code, and the fault is the provider's.
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

function validateQuery(query: string): { ok: true } | { ok: false; error: string } {
  if (!query) {
    return { ok: false, error: "Empty query." };
  }

  try {
    const ast = parse(query);
    if (isEmptyAST(ast)) {
      return { ok: false, error: "Empty query." };
    }

    const semanticError = validateAst(ast);
    if (semanticError) {
      return { ok: false, error: semanticError };
    }

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

export class TraceAiQueryService {
  static create(): TraceAiQueryService {
    return new TraceAiQueryService();
  }

  /**
   * Translates a natural-language description into our trace query language: calls the project's
   * default model with the grammar doc and a snapshot of categorical values, validates the output,
   * and loops up to MAX_ATTEMPTS feeding parse and validation errors back to the model.
   */
  static async generateTraceQueryFromPrompt(input: AiQueryInput): Promise<AiQueryResult> {
    const fieldsBlock = await input.traces.buildQueryFieldCatalogue({
      projectId: input.projectId,
      timeRange: input.timeRange,
    });
    const systemPrompt = buildSystemPrompt(fieldsBlock);
    const messages: ModelMessage[] = [{ role: "user", content: input.prompt }];

    const model = await input.resolveModel({
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
        content:
          `That query failed to parse: ${validation.error}\n\nReturn a valid query. ` +
          "Output ONLY the query, with no quotes, no prose, no leading or trailing punctuation.",
      });
    }

    return { ok: false, lastQuery, lastError, attempts: MAX_ATTEMPTS };
  }

  /**
   * Higher-level entry point: the model chooses between filtering the current view and creating a
   * named lens, returning a structured action the frontend dispatches. The embedded query is
   * validated and retried the same way, and exhaustion raises {@link AiQueryProviderError}.
   */
  static async generateTraceAction(input: AiQueryInput): Promise<AiActionResult> {
    const fieldsBlock = await input.traces.buildQueryFieldCatalogue({
      projectId: input.projectId,
      timeRange: input.timeRange,
    });
    const systemPrompt = buildActionSystemPrompt(fieldsBlock);
    const model = await input.resolveModel({
      projectId: input.projectId,
      featureKey: "traces.ai_search",
    });

    // Only the last attempt's failure kind is kept, so the detail rows describe what actually
    // happened on the final try rather than a stale status from an earlier blip.
    const attempts: AiActionAttemptState = {
      lastError: "Unknown error",
      lastQuery: "",
      lastFailure: null,
      lastProviderError: null,
    };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const action = await TraceAiQueryService.tryOneAction({
        input,
        model,
        systemPrompt,
        attempt,
        attempts,
      });
      if (action) {
        return action;
      }
    }

    // A raw SDK exception message must not leak: for a rejected key the provider's body is the
    // credential. The headline comes from the registry entry for this code either way, so both
    // exits raise the same one — one customer-visible failure, one remediation.
    throw new AiQueryProviderError(
      attempts.lastFailure === "provider"
        ? TraceAiQueryService.summarizeProviderError(attempts.lastProviderError, {
            model: modelIdOf(model),
          })
        : { reason: attempts.lastError, lastQuery: attempts.lastQuery },
    );
  }

  /**
   * One attempt at an action, or null when it failed and the caller should try again. Retry
   * context is only spliced in after a validation failure: after a provider throw there is no
   * query to quote, and quoting an empty one misleads the model about what it produced.
   */
  private static async tryOneAction({
    input,
    model,
    systemPrompt,
    attempt,
    attempts,
  }: {
    input: AiQueryInput;
    model: LanguageModel;
    systemPrompt: string;
    attempt: number;
    attempts: AiActionAttemptState;
  }): Promise<AiActionResult | null> {
    let parsedAction: z.infer<typeof aiActionSchema>;
    try {
      const { object } = await generateObject({
        model,
        schemaName: "TraceAction",
        schemaDescription:
          "Either an apply_query (filter the current view) or a create_lens (create a saved view) action with a trace query language string.",
        schema: aiActionSchema,
        system:
          attempt === 1 || attempts.lastFailure !== "validation"
            ? systemPrompt
            : `${systemPrompt}\n\nThe previous attempt produced query "${attempts.lastQuery}" ` +
              `which failed to parse: ${attempts.lastError}\nReturn a valid query this time.`,
        prompt: input.prompt,
        maxRetries: 1,
      });
      parsedAction = object;
    } catch (e) {
      attempts.lastFailure = "provider";
      attempts.lastProviderError = e;
      attempts.lastError = e instanceof Error ? e.message : "Unknown generation error.";
      logger.error(
        { projectId: input.projectId, attempt, lastError: attempts.lastError, err: e },
        "AI action generation failed",
      );

      return null;
    }

    attempts.lastQuery = parsedAction.query;
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

    attempts.lastFailure = "validation";
    attempts.lastError = validation.error;
    logger.info(
      {
        projectId: input.projectId,
        attempt,
        lastError: attempts.lastError,
        lastQuery: attempts.lastQuery,
      },
      "AI action query failed validation, retrying",
    );

    return null;
  }

  /**
   * Curates a provider exception into the operator-actionable fields the details disclosure
   * renders, preferring the SDK's structured status code and otherwise extracting one from text.
   * Only known-set values come back, never prose and never a headline: the registry owns that.
   */
  static summarizeProviderError(err: unknown, context?: { model?: string }): AiActionErrorDetails {
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

    // No `reason` on this exit: it used to be pulled straight out of the
    // failure body via regex, landing on the provider's own sentence —
    // exactly the field OpenAI answers a rejected key with, which on a
    // LangWatch-managed provider is OUR credential. Fields kept below are
    // operator-actionable and never free text; words stay the registry's.
    return {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(httpStatus ? { httpStatus } : {}),
    };
  }
}
