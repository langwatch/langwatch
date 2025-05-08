import type { Money } from "../../utils/types";
import { allLitellmModels } from "../modelProviders/registry";

export type ModelOption = {
  value: string;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
};

export const allowedTopicClusteringModels = Object.entries(allLitellmModels)
  .filter(([_, value]) => value.mode === "chat")
  .map(([key, _]) => key);

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
