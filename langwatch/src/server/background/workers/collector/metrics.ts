import { getLLMModelCosts } from "../../../modelProviders/llmModelCost";
import { type LLMSpan, type Span, type Trace } from "../../../tracer/types";
import { typedValueToText } from "./common";
import {
  estimateCost,
  matchingLLMModelCost,
  tokenizeAndEstimateCost,
} from "./cost";

// TODO: test
export const computeTraceMetrics = (spans: Span[]): Trace["metrics"] => {
  let earliestStartedAt: number | null = null;
  let latestFirstTokenAt: number | null = null;
  let latestFinishedAt: number | null = null;

  let totalPromptTokens: number | null = null;
  let totalCompletionTokens: number | null = null;
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
      if (span.metrics.tokens_estimated) {
        tokensEstimated = true;
      }
      if (span.metrics.cost !== undefined && span.metrics.cost !== null) {
        if (!totalCost) {
          totalCost = 0;
        }
        totalCost += span.metrics.cost;
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
    total_cost: totalCost,
    tokens_estimated: tokensEstimated,
  };
};

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
      if (
        llmSpan.input &&
        llmModelCost &&
        (llmSpan.metrics.prompt_tokens === undefined ||
          llmSpan.metrics.prompt_tokens === null)
      ) {
        llmSpan.metrics.prompt_tokens = (
          await tokenizeAndEstimateCost({
            llmModelCost,
            input: typedValueToText(llmSpan.input),
          })
        ).inputTokens;
        llmSpan.metrics.tokens_estimated = true;
      }
      if (
        llmSpan.output &&
        llmModelCost &&
        (llmSpan.metrics.completion_tokens === undefined ||
          llmSpan.metrics.completion_tokens === null)
      ) {
        let outputTokens = 0;
        outputTokens += (
          await tokenizeAndEstimateCost({
            llmModelCost,
            output: typedValueToText(llmSpan.output),
          })
        ).outputTokens;
        llmSpan.metrics.completion_tokens = outputTokens;
        llmSpan.metrics.tokens_estimated = true;
      }

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
        console.warn(
          `Guardrail cost is in ${span.output.value.cost.currency}, not USD, which is not supported yet`
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
