import { createLogger } from "../../../../utils/logger/server";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../../modelProviders/llmModelCost";
import type { LLMSpan, Span, Trace } from "../../../tracer/types";
import { typedValueToText } from "./common";
import {
  estimateCost,
  matchingLLMModelCost,
  tokenizeAndEstimateCost,
} from "./cost";

const logger = createLogger("langwatch:workers:collector:metrics");

// TODO: test
export const computeTraceMetrics = (spans: Span[]): Trace["metrics"] => {
  let earliestStartedAt: number | null = null;
  let latestFirstTokenAt: number | null = null;
  let latestFinishedAt: number | null = null;

  let totalPromptTokens: number | null = null;
  let totalCompletionTokens: number | null = null;
  let totalReasoningTokens: number | null = null;
  let totalCacheReadInputTokens: number | null = null;
  let totalCacheCreationInputTokens: number | null = null;
  let tokensEstimated = false;
  let totalCost: number | null = null;

  (spans ?? []).forEach((span) => {
    if (
      earliestStartedAt === null ||
      span.timestamps.started_at < earliestStartedAt
    ) {
      earliestStartedAt = span.timestamps.started_at;
    }

    if (
      span.timestamps.first_token_at &&
      (latestFirstTokenAt === null ||
        span.timestamps.first_token_at > latestFirstTokenAt)
    ) {
      latestFirstTokenAt = span.timestamps.first_token_at;
    }

    if (
      latestFinishedAt === null ||
      span.timestamps.finished_at > latestFinishedAt
    ) {
      latestFinishedAt = span.timestamps.finished_at;
    }

    if ("metrics" in span && span.metrics) {
      if (
        span.metrics.prompt_tokens !== undefined &&
        span.metrics.prompt_tokens !== null
      ) {
        if (!totalPromptTokens) {
          totalPromptTokens = 0;
        }
        totalPromptTokens += span.metrics.prompt_tokens;
      }
      if (
        span.metrics.completion_tokens !== undefined &&
        span.metrics.completion_tokens !== null
      ) {
        if (!totalCompletionTokens) {
          totalCompletionTokens = 0;
        }
        totalCompletionTokens += span.metrics.completion_tokens;
      }
      if (
        span.metrics.reasoning_tokens !== undefined &&
        span.metrics.reasoning_tokens !== null
      ) {
        if (!totalReasoningTokens) {
          totalReasoningTokens = 0;
        }
        totalReasoningTokens += span.metrics.reasoning_tokens;
      }
      if (
        span.metrics.cache_read_input_tokens !== undefined &&
        span.metrics.cache_read_input_tokens !== null
      ) {
        if (!totalCacheReadInputTokens) {
          totalCacheReadInputTokens = 0;
        }
        totalCacheReadInputTokens += span.metrics.cache_read_input_tokens;
      }
      if (
        span.metrics.cache_creation_input_tokens !== undefined &&
        span.metrics.cache_creation_input_tokens !== null
      ) {
        if (!totalCacheCreationInputTokens) {
          totalCacheCreationInputTokens = 0;
        }
        totalCacheCreationInputTokens +=
          span.metrics.cache_creation_input_tokens;
      }
      if (span.metrics.tokens_estimated) {
        tokensEstimated = true;
      }
      if (span.metrics.cost !== undefined && span.metrics.cost !== null) {
        if (!totalCost) {
          totalCost = 0;
        }
        totalCost = Number((totalCost + span.metrics.cost).toFixed(6));
      }
    }
  });

  return {
    first_token_ms:
      latestFirstTokenAt && earliestStartedAt
        ? latestFirstTokenAt - earliestStartedAt
        : null,
    total_time_ms:
      latestFinishedAt && earliestStartedAt
        ? latestFinishedAt - earliestStartedAt
        : null,
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    reasoning_tokens: totalReasoningTokens,
    cache_read_input_tokens: totalCacheReadInputTokens,
    cache_creation_input_tokens: totalCacheCreationInputTokens,
    total_cost: totalCost,
    tokens_estimated: tokensEstimated,
  };
};

// Fallback tokenizer used when no model cost match is found.
// gpt-4o is the most common tokenizer and a reasonable approximation for unknown models.
const FALLBACK_TOKENIZER = {
  projectId: "",
  model: "gpt-4o",
  regex: "^gpt-4o$",
} as const;

// TODO: test
export const addLLMTokensCount = async (projectId: string, spans: Span[]) => {
  const llmModelCosts = await getLLMModelCosts({ projectId });

  for (const span of spans) {
    if (span.type == "llm") {
      const llmSpan = span as LLMSpan;
      const llmModelCost =
        llmSpan.model && matchingLLMModelCost(llmSpan.model, llmModelCosts);

      if (!llmSpan.metrics) {
        llmSpan.metrics = {};
      }

      // Always tokenize — use matched model cost if found, otherwise fall back to gpt-4o.
      // Cost is only set when a real model match exists (no made-up pricing for unknown models).
      const tokenizerModel = llmModelCost || FALLBACK_TOKENIZER;

      if (
        llmSpan.input &&
        (llmSpan.metrics.prompt_tokens === undefined ||
          llmSpan.metrics.prompt_tokens === null)
      ) {
        const inputText = typedValueToText(llmSpan.input);

        const tokenResult = await tokenizeAndEstimateCost({
          llmModelCost: tokenizerModel,
          input: inputText,
        });

        llmSpan.metrics.prompt_tokens = tokenResult.inputTokens;
        llmSpan.metrics.tokens_estimated = true;
      }

      if (
        llmSpan.output &&
        (llmSpan.metrics.completion_tokens === undefined ||
          llmSpan.metrics.completion_tokens === null)
      ) {
        const outputText = typedValueToText(llmSpan.output);

        const tokenResult = await tokenizeAndEstimateCost({
          llmModelCost: tokenizerModel,
          output: outputText,
        });

        llmSpan.metrics.completion_tokens = tokenResult.outputTokens;
        llmSpan.metrics.tokens_estimated = true;
      }

      // Cost only set when a real model cost was matched (no made-up pricing)
      if (llmModelCost) {
        llmSpan.metrics.cost = estimateCost({
          llmModelCost,
          inputTokens: llmSpan.metrics.prompt_tokens ?? 0,
          outputTokens: llmSpan.metrics.completion_tokens ?? 0,
        });
      }
    }
  }
  return spans;
};

export const addGuardrailCosts = (spans: Span[]) => {
  for (const span of spans) {
    if (
      span.output &&
      span.output.type === "guardrail_result" &&
      span.output.value.cost
    ) {
      if (span.output.value.cost.currency !== "USD") {
        logger.warn(
          `Guardrail cost is in ${span.output.value.cost.currency}, not USD, which is not supported yet`,
        );
      }
      if (!span.metrics) {
        span.metrics = {};
      }
      span.metrics.cost = span.output.value.cost.amount;
    }
  }
  return spans;
};
