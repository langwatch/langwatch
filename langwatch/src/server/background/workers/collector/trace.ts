import { getOpenAIEmbeddings } from "../../../embeddings";
import type { Span, Trace } from "../../../tracer/types";
import { getFirstInputAsText, getLastOutputAsText } from "./common";

export const getTraceInput = async (
  spans: Span[],
  projectId: string
): Promise<Trace["input"]> => {
  const value = getFirstInputAsText(spans);
  const embeddings = value
    ? await getOpenAIEmbeddings(value, projectId)
    : undefined;
  return { value: value, embeddings };
};

export const getTraceOutput = async (
  spans: Span[],
  projectId: string
): Promise<Trace["output"]> => {
  const value = getLastOutputAsText(spans);
  const embeddings = value
    ? await getOpenAIEmbeddings(value, projectId)
    : undefined;
  return { value: value, embeddings };
};
