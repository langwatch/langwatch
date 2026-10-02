import {
  flattenSpanTree,
  organizeSpansIntoTree,
  typedValueToText,
} from "./trace-collector-common.ts";
import { spanInputOutputSchema } from "./trace-format.schemas.ts";
import type {
  ElasticSearchInputOutput,
  ElasticSearchSpan,
  RAGChunk,
  Span,
  SpanInputOutput,
} from "./trace-format.schemas.ts";
import { extractRAGTextualContext } from "./trace-rag-chunks.ts";

export const getRAGChunks = (spans: (ElasticSearchSpan | Span)[]): RAGChunk[] => {
  const sortedSpans = [
    ...flattenSpanTree(organizeSpansIntoTree(spans as Span[]), "inside-out"),
  ].reverse();
  const lastRagSpan = sortedSpans.find((span) => span.type === "rag") as
    | ElasticSearchSpan
    | undefined;
  if (!lastRagSpan) {
    return [];
  }

  return lastRagSpan.contexts ?? [];
};

export const getRAGInfo = (
  spans: (ElasticSearchSpan | Span)[],
): { input: string; output: string; contexts: string[] } => {
  const sortedSpans = [
    ...flattenSpanTree(organizeSpansIntoTree(spans as Span[]), "inside-out"),
  ].reverse();
  const lastRagSpan = sortedSpans.find((span) => span.type === "rag") as
    | ElasticSearchSpan
    | undefined;
  if (!lastRagSpan) {
    throw new Error("No 'rag' type span available");
  }

  const contexts = extractRAGTextualContext(lastRagSpan.contexts ?? []);
  if (!contexts.length) {
    throw new Error("RAG span does not have contexts");
  }
  if (!lastRagSpan.input) {
    throw new Error("RAG span does not have input");
  }
  if (!lastRagSpan.output) {
    throw new Error("RAG span does not have output");
  }

  let input = typedValueToText(elasticSearchToTypedValue(lastRagSpan.input), true);
  let output = typedValueToText(elasticSearchToTypedValue(lastRagSpan.output), true);

  try {
    input = JSON.parse(input);
    if (typeof input !== "string") {
      input = JSON.stringify(input);
    }
  } catch {
    /* this is just a safe json parse fallback */
    input = String(input);
  }

  try {
    output = JSON.parse(output);
    if (typeof output !== "string") {
      output = JSON.stringify(output);
    }
  } catch {
    /* this is just a safe json parse fallback */
    output = String(output);
  }

  return { input, output, contexts };
};

const elasticSearchToTypedValue = (typed: ElasticSearchInputOutput): SpanInputOutput => {
  try {
    return spanInputOutputSchema.parse({
      type: typed.type,
      value: typeof typed.value === "string" ? JSON.parse(typed.value) : typed.value,
    });
  } catch {
    return {
      type: "raw",
      value: typed.value,
    };
  }
};

const decodeOpenTelemetryId = (id: unknown): string | null => {
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
