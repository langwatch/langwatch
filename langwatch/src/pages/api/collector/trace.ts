import { getOpenAIEmbeddings } from "../../../server/embeddings";
import type {
  Span,
  SpanInputOutput,
  Trace,
} from "../../../server/tracer/types";
import {
  getFirstInputAsText,
  getLastOutputAsText,
  isEmptyValue,
  typedValueToText,
} from "./common";

export const getTraceInput = async (
  traceInput: SpanInputOutput | null | undefined,
  spans: Span[]
): Promise<Trace["input"]> => {
  const value =
    traceInput && !isEmptyValue(traceInput)
      ? typedValueToText(traceInput, true)
      : getFirstInputAsText(spans);
  const embeddings = value ? await getOpenAIEmbeddings(value) : undefined;
  return { value: value, embeddings };
};

export const getTraceOutput = async (
  traceOutput: SpanInputOutput | null | undefined,
  spans: Span[]
): Promise<Trace["output"]> => {
  const value =
    traceOutput && !isEmptyValue(traceOutput)
      ? typedValueToText(traceOutput, true)
      : getLastOutputAsText(spans);
  const embeddings = value ? await getOpenAIEmbeddings(value) : undefined;
  return { value: value, embeddings };
};
