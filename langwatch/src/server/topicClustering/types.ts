import type { Money } from "../../utils/types";

export const allowedTopicClusteringModels = [
  "azure/gpt-4-turbo-2024-04-09",
  "openai/gpt-4o",
  "anthropic/claude-3-opus-20240229",
  "vertex_ai/gemini-1.5-pro-001",
  "groq/llama3-70b-8192",
];

export const allowedEmbeddingsModels = ["openai/text-embedding-3-small"];

export type TopicClusteringTrace = {
  trace_id: string;
  input: string;
  embeddings: number[];
  topic_id: string | null;
  subtopic_id: string | null;
};

export type TopicClusteringTopic = {
  id: string;
  name: string;
  centroid: number[];
  p95_distance: number;
};

export type TopicClusteringSubtopic = TopicClusteringTopic & {
  parent_id: string;
};

export type TopicClusteringTraceTopicMap = {
  trace_id: string;
  topic_id: string | null;
  subtopic_id: string | null;
};

export type BatchClusteringParams = {
  model: string;
  litellm_params: Record<string, string>;
  traces: TopicClusteringTrace[];
};

export type IncrementalClusteringParams = {
  model: string;
  litellm_params: Record<string, string>;
  topics: TopicClusteringTopic[];
  subtopics: TopicClusteringSubtopic[];
  traces: TopicClusteringTrace[];
};

export type TopicClusteringResponse = {
  topics: TopicClusteringTopic[];
  subtopics: TopicClusteringSubtopic[];
  traces: TopicClusteringTraceTopicMap[];
  cost: Money;
};
