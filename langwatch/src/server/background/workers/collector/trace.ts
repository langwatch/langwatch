import { getOpenAIEmbeddings } from "../../../embeddings";
import type { Span, Trace } from "../../../tracer/types";
import { getFirstInputAsText, getLastOutputAsText } from "./common";

export const getTraceInput = async (
  spans: Span[],
  projectId: string
): Promise<Trace["input"]> => {
  const value = getFirstInputAsText(spans);
  let embeddings = undefined;
  if (value) {
    try {
      embeddings = await getOpenAIEmbeddings(value, projectId);
    } catch (e) {
      console.error(`Error getting embeddings for trace input: ${e as any}`);
    }
  }
  return { value: value, embeddings };
};

export const getTraceOutput = async (
  spans: Span[],
  projectId: string
): Promise<Trace["output"]> => {
  const value = getLastOutputAsText(spans);
  let embeddings = undefined;
  if (value) {
    try {
      embeddings = await getOpenAIEmbeddings(value, projectId);
    } catch (e) {
      console.error(`Error getting embeddings for trace input: ${e as any}`);
    }
  }
  return { value: value, embeddings };
};
