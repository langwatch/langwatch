import {
  flattenSpanTree,
  organizeSpansIntoTree,
  typedValueToText,
} from "../../pages/api/collector/common";
import { extractRAGTextualContext } from "../../pages/api/collector/rag";
import type { ElasticSearchSpan, Span, SpanInputOutput } from "./types";

export const getRAGInfo = (
  spans: ElasticSearchSpan[]
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
  const firstOutput = lastRagSpan.outputs[0];
  if (typeof firstOutput == "undefined") {
    throw new Error("RAG span does not have output");
  }

  let input = typedValueToText(lastRagSpan.input as SpanInputOutput, true);
  let output = typedValueToText(firstOutput as SpanInputOutput, true);

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
