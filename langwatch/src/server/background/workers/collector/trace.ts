import { getOpenAIEmbeddings } from "../../../embeddings";
import type { Span, Trace } from "../../../tracer/types";
import { getFirstInputAsText, getLastOutputAsText } from "./common";

export const getTraceInput = async (spans: Span[]): Promise<Trace["input"]> => {
  const value = getFirstInputAsText(spans);
  const embeddings = value ? await getOpenAIEmbeddings(value) : undefined;
  return { value: value, embeddings };
};

export const getTraceOutput = async (
  spans: Span[]
): Promise<Trace["output"]> => {
  const value = getLastOutputAsText(spans);
  const embeddings = value ? await getOpenAIEmbeddings(value) : undefined;
  return { value: value, embeddings };
};
