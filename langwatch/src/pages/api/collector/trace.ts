import { getOpenAIEmbeddings } from "../../../server/embeddings";
import type { TraceInputOutput, ErrorCapture, Span, Trace } from "../../../server/tracer/types";
import { getFirstInputAsText, getLastOutputAsText } from "./common";

export const getTraceInput = async (spans: Span[]): Promise<Trace["input"]> => {
  const value = getFirstInputAsText(spans);
  const openai_embeddings = value
    ? await getOpenAIEmbeddings(value)
    : undefined;
  return { value: value, openai_embeddings };
};

export const getTraceOutput = async (spans: Span[]): Promise<Trace["output"]> => {
  const value = getLastOutputAsText(spans);
  const openai_embeddings = value
    ? await getOpenAIEmbeddings(value)
    : undefined;
  return { value: value, openai_embeddings };
};

export const getSearchEmbeddings = async (
  input: TraceInputOutput,
  output: TraceInputOutput | undefined,
  error: ErrorCapture | null
): Promise<number[] | undefined> => {
  const terms = [input.value, output?.value ?? "", error?.message ?? ""];
  if (terms.filter((term) => term).length == 0) {
    return undefined;
  }

  return await getOpenAIEmbeddings(terms.join("\n\n"));
};
