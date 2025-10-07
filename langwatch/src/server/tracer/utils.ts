import {
  flattenSpanTree,
  organizeSpansIntoTree,
  typedValueToText,
} from "../background/workers/collector/common";
import { extractRAGTextualContext } from "../background/workers/collector/rag";
import {
  type ElasticSearchEvent,
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type Event,
  type Span,
  type SpanInputOutput,
  type ElasticSearchEvaluation,
  type Evaluation,
  type RAGChunk,
} from "./types";

export const getRAGChunks = (
  spans: (ElasticSearchSpan | Span)[]
): RAGChunk[] => {
  const sortedSpans = flattenSpanTree(
    organizeSpansIntoTree(spans as Span[]),
    "inside-out"
  ).reverse();
  const lastRagSpan = sortedSpans.find((span) => span.type === "rag") as
    | ElasticSearchSpan
    | undefined;
  if (!lastRagSpan) {
    return [];
  }

  return lastRagSpan.contexts ?? [];
};

export const getRAGInfo = (
  spans: (ElasticSearchSpan | Span)[]
): { input: string; output: string; contexts: string[] } => {
  const sortedSpans = flattenSpanTree(
    organizeSpansIntoTree(spans as Span[]),
    "inside-out"
  ).reverse();
  const lastRagSpan = sortedSpans.find((span) => span.type === "rag") as
    | ElasticSearchSpan
    | undefined;
  if (!lastRagSpan) {
    throw new Error("No 'rag' type span available");
  }

  const contexts = extractRAGTextualContext(lastRagSpan.contexts ?? []);
  if (!lastRagSpan) {
    throw new Error("RAG span does not have contexts");
  }
  if (!lastRagSpan.input) {
    throw new Error("RAG span does not have input");
  }
  if (!lastRagSpan.output) {
    throw new Error("RAG span does not have output");
  }

  let input = typedValueToText(
    elasticSearchToTypedValue(lastRagSpan.input),
    true
  );
  let output = typedValueToText(
    elasticSearchToTypedValue(lastRagSpan.output),
    true
  );

  try {
    input = JSON.parse(input);
    if (typeof input !== "string") {
      input = JSON.stringify(input);
    }
  } catch (e) {}

  try {
    output = JSON.parse(output);
    if (typeof output !== "string") {
      output = JSON.stringify(output);
    }
  } catch (e) {}

  return { input, output, contexts };
};

export const elasticSearchToTypedValue = (
  typed: ElasticSearchInputOutput
): SpanInputOutput => {
  try {
    return {
      type: typed.type,
      value:
        typeof typed.value === "string" ? JSON.parse(typed.value) : typed.value,
    } as any;
  } catch (e) {
    return {
      type: "raw",
      value: typed.value,
    };
  }
};

export const elasticSearchEvaluationsToEvaluations = (
  elasticSearchEvaluations: ElasticSearchEvaluation[]
): Evaluation[] => {
  return elasticSearchEvaluations.map((evaluation) => {
    return evaluation;
  });
};

export const elasticSearchEventsToEvents = (
  elasticSearchEvents: ElasticSearchEvent[]
): Event[] => {
  return elasticSearchEvents.map(elasticSearchEventToEvent);
};

export const elasticSearchEventToEvent = (event: ElasticSearchEvent): Event => {
  return {
    ...event,
    metrics: Object.fromEntries(
      event.metrics.map((metric) => [metric.key, metric.value])
    ),
    event_details: Object.fromEntries(
      event.event_details.map((detail) => [detail.key, detail.value])
    ),
  };
};

export const decodeOpenTelemetryId = (id: unknown): string | null => {
  if (typeof id === "string") {
    return id;
  }
  if (id && typeof id === "object" && id.constructor === Uint8Array) {
    return Buffer.from(id as Uint8Array).toString("hex");
  }

  return null;
};

export const decodeBase64OpenTelemetryId = (id: unknown): string | null => {
  if (typeof id === "string") {
    // Detect if it's a base64 string by checking for base64-specific characters
    // Base64 encoding uses +, /, and = for padding which are never in hex strings or plain strings
    // Only decode if we're confident it's base64
    const looksLikeBase64 = /[+/=]/.test(id);

    if (looksLikeBase64) {
      try {
        return Buffer.from(id, "base64").toString("hex");
      } catch {
        // If base64 decode fails, return as-is
        return id;
      }
    }

    // Already a hex string or plain string ID, return as-is
    return id;
  }

  // For Uint8Array, use the standard decoder
  return decodeOpenTelemetryId(id);
};

export const convertFromUnixNano = (timeUnixNano: unknown): number => {
  let unixNano: number;

  if (typeof timeUnixNano === "number") {
    unixNano = timeUnixNano;
  } else if (typeof timeUnixNano === "string") {
    const parsed = parseInt(timeUnixNano, 10);
    unixNano = !isNaN(parsed) ? parsed : Date.now() * 1000000;
  } else if (
    timeUnixNano &&
    typeof timeUnixNano === "object" &&
    "low" in timeUnixNano &&
    "high" in timeUnixNano
  ) {
    const { low = 0, high = 0 } = timeUnixNano as any;
    unixNano = high * 0x100000000 + low;
  } else {
    unixNano = Date.now() * 1000000;
  }

  // Convert nanoseconds to milliseconds
  return Math.round(unixNano / 1000000);
};

export const setNestedProperty = (
  obj: Record<string, any>,
  path: string,
  value: any
): void => {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value;
};
