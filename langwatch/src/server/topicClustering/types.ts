import type { Money } from "../../utils/types";

import models from "../../../../models.json";

export type ModelOption = {
  value: string;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | "evaluator" | undefined;
};
export const modelSelectorOptions: ModelOption[] = Object.entries(models).map(
  ([key, value]) => ({
    value: key,
    isDisabled: false,
    mode: value.mode as "chat" | "embedding" | "evaluator",
  })
);

export const allowedTopicClusteringModels = modelSelectorOptions
  .filter((option) => option.mode === "chat")
  .map((option) => option.value);

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
  litellm_params: Record<string, string>;
  embeddings_litellm_params: Record<string, any>;
  traces: TopicClusteringTrace[];
};

export type IncrementalClusteringParams = {
  litellm_params: Record<string, string>;
  embeddings_litellm_params: Record<string, any>;
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
