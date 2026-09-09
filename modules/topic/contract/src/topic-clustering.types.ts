/**
 * Wire values for the topic-clustering langevals calls (contract.md §11) —
 * the request params the runner posts and the response it reads back.
 * Portable shapes only; the runner lives in `@langwatch/topic-server`.
 */

export type ModelOption = {
  value: string;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
};

export type TopicClusteringTrace = {
  trace_id: string;
  input: string;
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
  project_id: string;
  litellm_params: Record<string, string>;
  embeddings_litellm_params: Record<string, unknown>;
  traces: TopicClusteringTrace[];
};

export type IncrementalClusteringParams = {
  project_id: string;
  litellm_params: Record<string, string>;
  embeddings_litellm_params: Record<string, unknown>;
  topics: TopicClusteringTopic[];
  subtopics: TopicClusteringSubtopic[];
  traces: TopicClusteringTrace[];
};

/** The clustering call's billed cost. */
export type TopicClusteringCost = { amount: number; currency: "USD" | "EUR" };

export type TopicClusteringResponse = {
  topics: TopicClusteringTopic[];
  subtopics: TopicClusteringSubtopic[];
  traces: TopicClusteringTraceTopicMap[];
  cost: TopicClusteringCost;
};
