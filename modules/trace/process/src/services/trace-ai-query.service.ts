/**
 * The AI trace-query composer: turns a sentence into a trace query, a lens, a
 * judge question or a search route, on the project's `traces.ai_search` model.
 * Ported from main's ai-query.ts; the model calls go through ModelProviderApi.
 */

import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import {
  type AiActionResult,
  type AiQueryResult,
  AiQueryProviderError,
  type InstantEvalQuestionResult,
  type TraceApi,
} from "@langwatch/trace-contract";
import type { z } from "zod";

import {
  aiActionSchema,
  instantEvalQuestionSchema,
  MAX_ATTEMPTS,
  providerErrorLogPayload,
  type QueryRetry,
  sanitizeLlmOutput,
  searchRouteSchema,
  summarizeProviderError,
  validateQuery,
  withRetryNote,
} from "../rules/trace-ai-query-output.rules.ts";
import {
  buildActionSystemPrompt,
  buildInstantEvalQuestionPrompt,
  buildSearchRoutePrompt,
  buildSystemPrompt,
} from "../rules/trace-ai-query-prompt.rules.ts";
import {
  buildFieldsBlock,
  CATEGORICAL_FACET_KEYS,
  DYNAMIC_VALUES_LIMIT,
} from "../rules/trace-query-field-catalogue.rules.ts";
import type { SearchRouteDecision, TraceSearchRouterDeps } from "./trace-search-router.service.ts";

const logger = createLogger("langwatch:ai-query");

const FEATURE_KEY = "traces.ai_search";
// Main set no timeout on these calls; generateStructured requires one. Pending a ruling.
const STRUCTURED_TIMEOUT_MS = 30_000;

type FilterInput = Parameters<TraceSearchRouterDeps["buildFilter"]>[0];
type QuestionInput = Parameters<TraceSearchRouterDeps["buildQuestion"]>[0];
type SearchRouteInput = Parameters<TraceSearchRouterDeps["routeWithModel"]>[0];

/** A model answer that closes the loop, or the reason to ask again. */
type SearchRouteAttempt = { done: SearchRouteDecision } | { retry: QueryRetry };

function interpretSearchRouteObject({
  decision,
  isLangyAvailable,
  isInstantEvalAvailable,
}: {
  decision: z.infer<typeof searchRouteSchema>;
  isLangyAvailable: boolean;
  isInstantEvalAvailable: boolean;
}): SearchRouteAttempt {
  switch (decision.route) {
    case "filter": {
      const validation = validateQuery(decision.query);
      if (validation.ok) return { done: { route: "filter", query: decision.query } };
      return { retry: { lastQuery: decision.query, lastError: validation.error } };
    }
    case "instant_eval":
      if (!isInstantEvalAvailable) return { done: { route: "free_text" } };
      return {
        done: {
          route: "instant_eval",
          instructions: decision.instructions,
          criteria: [decision.yes, decision.no],
        },
      };
    case "langy":
      return { done: { route: isLangyAvailable ? "langy" : "free_text" } };
    case "free_text":
      return { done: { route: "free_text" } };
  }
}

export class TraceAiQueryService {
  private constructor(
    private readonly models: Pick<ModelProviderApi, "generateText" | "generateStructured">,
    private readonly facets: Pick<TraceApi, "readFacetValues">,
  ) {}

  static create({
    models,
    facets,
  }: {
    models: Pick<ModelProviderApi, "generateText" | "generateStructured">;
    facets: Pick<TraceApi, "readFacetValues">;
  }): TraceAiQueryService {
    return new TraceAiQueryService(models, facets);
  }

  /** Sentence to query, feeding each parse failure back to the model, up to MAX_ATTEMPTS. */
  async generateTraceQueryFromPrompt(input: FilterInput): Promise<AiQueryResult> {
    const system = buildSystemPrompt(await this.buildFieldsBlock(input));
    const messages: { role: "user" | "assistant"; content: string }[] = [
      { role: "user", content: input.prompt },
    ];
    let lastQuery = "";
    let lastError = "Unknown error";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { text } = await this.models.generateText({
        projectId: input.projectId,
        featureKey: FEATURE_KEY,
        system,
        messages,
        temperature: 0,
        maxRetries: 1,
      });
      lastQuery = sanitizeLlmOutput(text);
      const validation = validateQuery(lastQuery);
      if (validation.ok) return { ok: true, query: lastQuery, attempts: attempt };
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
          `Output ONLY the query, with no quotes, no prose, no leading or trailing punctuation.`,
      });
    }
    return { ok: false, lastQuery, lastError, attempts: MAX_ATTEMPTS };
  }

  /** Apply a query or create a lens; raises AiQueryProviderError once attempts run out. */
  async generateTraceAction(input: FilterInput): Promise<AiActionResult> {
    const systemPrompt = buildActionSystemPrompt(await this.buildFieldsBlock(input));
    let retry: QueryRetry | null = null;
    let lastProviderError: { error: unknown } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let action: z.infer<typeof aiActionSchema>;
      try {
        action = aiActionSchema.parse(
          await this.models.generateStructured({
            projectId: input.projectId,
            featureKey: FEATURE_KEY,
            schema: aiActionSchema,
            system: withRetryNote({ systemPrompt, retry }),
            prompt: input.prompt,
            timeoutMs: STRUCTURED_TIMEOUT_MS,
            maxRetries: 1,
          }),
        );
      } catch (error) {
        lastProviderError = { error };
        retry = null;
        logger.error(
          providerErrorLogPayload({ projectId: input.projectId, attempt, error }),
          "AI action generation failed",
        );
        continue;
      }
      const validation = validateQuery(action.query);
      if (validation.ok) {
        return action.kind === "apply_query"
          ? { ok: true, kind: "apply_query", query: action.query }
          : { ok: true, kind: "create_lens", name: action.name, query: action.query };
      }
      lastProviderError = null;
      retry = { lastQuery: action.query, lastError: validation.error };
      logger.info(
        { projectId: input.projectId, attempt, ...retry },
        "AI action query failed validation, retrying",
      );
    }
    throw new AiQueryProviderError(
      lastProviderError
        ? summarizeProviderError(lastProviderError.error)
        : { reason: retry?.lastError ?? "Unknown error", lastQuery: retry?.lastQuery ?? "" },
    );
  }

  /** A judge question, or a filter over a signal the project already records. */
  async generateInstantEvalQuestion(input: QuestionInput): Promise<InstantEvalQuestionResult> {
    let object: z.infer<typeof instantEvalQuestionSchema>;
    try {
      object = instantEvalQuestionSchema.parse(
        await this.models.generateStructured({
          projectId: input.projectId,
          featureKey: FEATURE_KEY,
          schema: instantEvalQuestionSchema,
          system: buildInstantEvalQuestionPrompt({ target: input.target, known: input.known }),
          prompt: input.text,
          timeoutMs: STRUCTURED_TIMEOUT_MS,
          maxRetries: 1,
        }),
      );
    } catch (error) {
      logger.error(
        providerErrorLogPayload({ projectId: input.projectId, error }),
        "Instant Eval question generation failed",
      );
      throw new AiQueryProviderError(summarizeProviderError(error));
    }
    if (object.kind === "question") {
      return {
        kind: "question",
        instructions: object.instructions,
        criteria: [object.yes, object.no],
      };
    }
    const validation = validateQuery(object.query);
    if (!validation.ok) {
      throw new AiQueryProviderError({ reason: validation.error, lastQuery: object.query });
    }
    return { kind: "filter", query: object.query, reason: object.reason };
  }

  /** Decides the route and builds what it needs in one call, when there is no classifier. */
  async generateSearchRoute(input: SearchRouteInput): Promise<SearchRouteDecision> {
    const systemPrompt = buildSearchRoutePrompt({
      fieldsBlock: await this.buildFieldsBlock(input),
      target: input.target,
      known: input.known,
      isLangyAvailable: input.isLangyAvailable,
      isInstantEvalAvailable: input.isInstantEvalAvailable,
    });
    let retry: QueryRetry | null = null;
    let providerError: { error: unknown } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let decision: z.infer<typeof searchRouteSchema>;
      try {
        decision = searchRouteSchema.parse(
          await this.models.generateStructured({
            projectId: input.projectId,
            featureKey: FEATURE_KEY,
            schema: searchRouteSchema,
            system: withRetryNote({ systemPrompt, retry }),
            prompt: input.text,
            timeoutMs: STRUCTURED_TIMEOUT_MS,
            maxRetries: 1,
          }),
        );
      } catch (error) {
        providerError = { error };
        retry = null;
        logger.error(
          providerErrorLogPayload({ projectId: input.projectId, attempt, error }),
          "Search route generation failed",
        );
        continue;
      }
      const outcome = interpretSearchRouteObject({
        decision,
        isLangyAvailable: input.isLangyAvailable,
        isInstantEvalAvailable: input.isInstantEvalAvailable,
      });
      if ("done" in outcome) return outcome.done;
      providerError = null;
      retry = outcome.retry;
      logger.info(
        { projectId: input.projectId, attempt, ...retry },
        "Search route query failed validation, retrying",
      );
    }
    throw new AiQueryProviderError(
      providerError
        ? summarizeProviderError(providerError.error)
        : { reason: retry?.lastError ?? "Unknown error", lastQuery: retry?.lastQuery ?? "" },
    );
  }

  /** `allSettled`: one failing facet drops that field's examples, never the catalogue. */
  private async buildFieldsBlock({
    projectId,
    timeRange,
  }: {
    projectId: string;
    timeRange: { from: number; to: number };
  }): Promise<string> {
    const results = await Promise.allSettled(
      CATEGORICAL_FACET_KEYS.map((facetKey) =>
        this.facets.readFacetValues({
          tenantId: projectId,
          timeRange,
          facetKey,
          limit: DYNAMIC_VALUES_LIMIT,
          offset: 0,
        }),
      ),
    );
    const dynamicValues = new Map<string, string[]>();
    results.forEach((result, index) => {
      const facetKey = CATEGORICAL_FACET_KEYS[index];
      if (facetKey === undefined || result.status !== "fulfilled") return;
      dynamicValues.set(
        facetKey,
        result.value.values.map((value) => value.value),
      );
    });
    return buildFieldsBlock({ dynamicValues });
  }
}
