import {
  flattenSpanTree,
  organizeSpansIntoTree,
  typedValueToText,
} from "../pages/api/collector/common";
import type {
  ElasticSearchSpan,
  Span,
  SpanInput,
  SpanOutput,
} from "../server/tracer/types";

export const getRAGInfo = (spans: ElasticSearchSpan[]) => {
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

  const contexts = lastRagSpan.contexts ?? [];
  if (!lastRagSpan) {
    throw new Error("RAG span does not have contexts");
  }
  if (!lastRagSpan.input) {
    throw new Error("RAG span does not have input");
  }
  const firstOutput = lastRagSpan.outputs[0];
  if (typeof firstOutput == "undefined") {
    throw new Error("RAG span does not have ");
  }

  let input = typedValueToText(lastRagSpan.input as SpanInput, true);
  let output = typedValueToText(firstOutput as SpanOutput, true);

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
