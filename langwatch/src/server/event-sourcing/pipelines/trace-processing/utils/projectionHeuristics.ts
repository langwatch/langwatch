import type { SpanData, TraceProjectionData } from "../types";

const INPUT_ATTRIBUTE_KEYS = [
  "llm.prompt",
  "gen_ai.prompt",
  "gen_ai.input",
  "request.body",
  "langwatch.prompt",
];

const OUTPUT_ATTRIBUTE_KEYS = [
  "llm.completion",
  "gen_ai.output",
  "response.body",
  "langwatch.response",
];

const MODEL_ATTRIBUTE_KEYS = [
  "llm.model",
  "gen_ai.model",
  "openai.model",
  "model.name",
];

const PROMPT_TOKEN_KEYS = [
  "llm.prompt_tokens",
  "gen_ai.prompt_tokens",
  "usage.prompt_tokens",
];

const COMPLETION_TOKEN_KEYS = [
  "llm.completion_tokens",
  "gen_ai.completion_tokens",
  "usage.completion_tokens",
];

const FIRST_TOKEN_REGEX = /first[_\s-]?token/i;
const LAST_TOKEN_REGEX = /last[_\s-]?token/i;

export interface ProjectionHeuristicResult
  extends Partial<TraceProjectionData> {
  computedMetadata?: Record<string, string>;
}

export function detectInputOutput(
  spans: readonly SpanData[],
): ProjectionHeuristicResult {
  const computedInput = findFirstAttribute(spans, INPUT_ATTRIBUTE_KEYS);
  const computedOutput = findFirstAttribute(spans, OUTPUT_ATTRIBUTE_KEYS);

  return {
    computedInput,
    computedOutput,
    computedMetadata: {
      ...(computedInput ? { detected_input_source: "attributes" } : {}),
      ...(computedOutput ? { detected_output_source: "attributes" } : {}),
    },
  };
}

export function computeTimingMetrics(
  spans: readonly SpanData[],
): ProjectionHeuristicResult {
  if (spans.length === 0) {
    return {
      totalDurationMs: 0,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
    };
  }

  const startTimes = spans.map((span) => span.startTimeUnixMs);
  const endTimes = spans.map((span) => span.endTimeUnixMs);
  const earliestStart = Math.min(...startTimes);
  const latestEnd = Math.max(...endTimes);

  const firstTokenEvent = findEventByRegex(spans, FIRST_TOKEN_REGEX);
  const lastTokenEvent = findEventByRegex(spans, LAST_TOKEN_REGEX);

  return {
    totalDurationMs: Math.max(0, latestEnd - earliestStart),
    timeToFirstTokenMs: firstTokenEvent
      ? Math.max(0, firstTokenEvent.timeUnixMs - earliestStart)
      : null,
    timeToLastTokenMs: lastTokenEvent
      ? Math.max(0, lastTokenEvent.timeUnixMs - earliestStart)
      : null,
  };
}

export function deriveStatusFlags(
  spans: readonly SpanData[],
): ProjectionHeuristicResult {
  const hasError = spans.some((span) => span.status.code === 2);
  const hasOk = spans.some((span) => span.status.code === 1);

  return {
    containsErrorStatus: hasError,
    containsOKStatus: hasOk,
  };
}

export function deriveModelInfo(
  spans: readonly SpanData[],
): ProjectionHeuristicResult {
  const models = collectUniqueAttributeValues(spans, MODEL_ATTRIBUTE_KEYS);
  return {
    models: models.length ? models.join(",") : null,
  };
}

export function aggregateTokenMetrics(
  spans: readonly SpanData[],
): ProjectionHeuristicResult {
  const totalPromptTokenCount = sumAttributes(spans, PROMPT_TOKEN_KEYS);
  const totalCompletionTokenCount = sumAttributes(spans, COMPLETION_TOKEN_KEYS);

  return {
    totalPromptTokenCount: totalPromptTokenCount ?? null,
    totalCompletionTokenCount: totalCompletionTokenCount ?? null,
  };
}

export function deriveTokensPerSecond(
  metrics: ProjectionHeuristicResult,
): ProjectionHeuristicResult {
  if (
    metrics.totalCompletionTokenCount === null ||
    metrics.totalCompletionTokenCount === void 0 ||
    !metrics.totalDurationMs ||
    metrics.totalDurationMs <= 0
  ) {
    return { tokensPerSecond: null };
  }

  const seconds = metrics.totalDurationMs / 1000;
  const rate = seconds > 0 ? metrics.totalCompletionTokenCount / seconds : null;
  return {
    tokensPerSecond: rate ? Math.round(rate) : null,
  };
}

export function mergeHeuristics(
  base: TraceProjectionData,
  ...partials: ProjectionHeuristicResult[]
): TraceProjectionData {
  return partials.reduce<TraceProjectionData>(
    (acc, partial) => ({
      ...acc,
      ...partial,
      computedMetadata: {
        ...acc.computedMetadata,
        ...partial.computedMetadata,
      },
    }),
    base,
  );
}

function findFirstAttribute(
  spans: readonly SpanData[],
  keys: readonly string[],
): string | null {
  for (const span of spans) {
    for (const key of keys) {
      const value = span.attributes?.[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function collectUniqueAttributeValues(
  spans: readonly SpanData[],
  keys: readonly string[],
): string[] {
  const values = new Set<string>();
  for (const span of spans) {
    for (const key of keys) {
      const value = span.attributes?.[key];
      if (typeof value === "string" && value.length > 0) {
        values.add(value);
      }
    }
  }
  return [...values];
}

function sumAttributes(
  spans: readonly SpanData[],
  keys: readonly string[],
): number | undefined {
  let total: number | undefined;
  for (const span of spans) {
    for (const key of keys) {
      const raw = span.attributes?.[key];
      const parsed = typeof raw === "string" ? Number(raw) : raw;
      if (typeof parsed === "number" && !Number.isNaN(parsed)) {
        total = (total ?? 0) + parsed;
      }
    }
  }
  return total;
}

function findEventByRegex(spans: readonly SpanData[], regex: RegExp) {
  for (const span of spans) {
    const event = span.events.find((eventItem) => regex.test(eventItem.name));
    if (event) {
      return event;
    }
  }
  return null;
}

export const ProjectionHeuristics = {
  detectInputOutput,
  computeTimingMetrics,
  deriveStatusFlags,
  deriveModelInfo,
  aggregateTokenMetrics,
  deriveTokensPerSecond,
  mergeHeuristics,
} as const;
