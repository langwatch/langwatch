/**
 * Wire values for the topic-clustering langevals calls (contract.md §11) —
 * the request params the runner posts and the response it reads back.
 * Portable shapes only; the runner lives in `@langwatch/topic-process`.
 */
import { z } from "zod";

export type ModelOption = {
  value: string;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
};

export const topicClusteringTraceSchema = z.object({
  trace_id: z.string(),
  input: z.string(),
  topic_id: z.string().nullable(),
  subtopic_id: z.string().nullable(),
});

export type TopicClusteringTrace = z.infer<typeof topicClusteringTraceSchema>;

export const topicClusteringTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  centroid: z.array(z.number()),
  p95_distance: z.number(),
});

export type TopicClusteringTopic = z.infer<typeof topicClusteringTopicSchema>;

export const topicClusteringSubtopicSchema = z.object({
  ...topicClusteringTopicSchema.shape,
  parent_id: z.string(),
});

export type TopicClusteringSubtopic = z.infer<typeof topicClusteringSubtopicSchema>;

export const topicClusteringTraceTopicMapSchema = z.object({
  trace_id: z.string(),
  topic_id: z.string().nullable(),
  subtopic_id: z.string().nullable(),
});

export type TopicClusteringTraceTopicMap = z.infer<typeof topicClusteringTraceTopicMapSchema>;

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
export const topicClusteringCostSchema = z.object({
  amount: z.number(),
  currency: z.enum(["USD", "EUR"]),
});

export type TopicClusteringCost = z.infer<typeof topicClusteringCostSchema>;

export const topicClusteringResponseSchema = z.object({
  topics: z.array(topicClusteringTopicSchema),
  subtopics: z.array(topicClusteringSubtopicSchema),
  traces: z.array(topicClusteringTraceTopicMapSchema),
  cost: topicClusteringCostSchema,
});

export type TopicClusteringResponse = z.infer<typeof topicClusteringResponseSchema>;
