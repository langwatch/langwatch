import type { Named } from "@langwatch/module";
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

const topicClusteringTraceSchemaDefinition = z.object({
  trace_id: z.string(),
  input: z.string(),
  topic_id: z.string().nullable(),
  subtopic_id: z.string().nullable(),
});
export interface TopicClusteringTraceSchema extends Named<
  typeof topicClusteringTraceSchemaDefinition
> {}
export const topicClusteringTraceSchema: TopicClusteringTraceSchema =
  topicClusteringTraceSchemaDefinition;

export type TopicClusteringTrace = z.infer<typeof topicClusteringTraceSchema>;

const topicClusteringTopicSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  centroid: z.array(z.number()),
  p95_distance: z.number(),
});
export interface TopicClusteringTopicSchema extends Named<
  typeof topicClusteringTopicSchemaDefinition
> {}
export const topicClusteringTopicSchema: TopicClusteringTopicSchema =
  topicClusteringTopicSchemaDefinition;

export type TopicClusteringTopic = z.infer<typeof topicClusteringTopicSchema>;

const topicClusteringSubtopicSchemaDefinition = z.object({
  ...topicClusteringTopicSchema.shape,
  parent_id: z.string(),
});
export interface TopicClusteringSubtopicSchema extends Named<
  typeof topicClusteringSubtopicSchemaDefinition
> {}
export const topicClusteringSubtopicSchema: TopicClusteringSubtopicSchema =
  topicClusteringSubtopicSchemaDefinition;

export type TopicClusteringSubtopic = z.infer<typeof topicClusteringSubtopicSchema>;

const topicClusteringTraceTopicMapSchemaDefinition = z.object({
  trace_id: z.string(),
  topic_id: z.string().nullable(),
  subtopic_id: z.string().nullable(),
});
export interface TopicClusteringTraceTopicMapSchema extends Named<
  typeof topicClusteringTraceTopicMapSchemaDefinition
> {}
export const topicClusteringTraceTopicMapSchema: TopicClusteringTraceTopicMapSchema =
  topicClusteringTraceTopicMapSchemaDefinition;

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
const topicClusteringCostSchemaDefinition = z.object({
  amount: z.number(),
  currency: z.enum(["USD", "EUR"]),
});
export interface TopicClusteringCostSchema extends Named<
  typeof topicClusteringCostSchemaDefinition
> {}
export const topicClusteringCostSchema: TopicClusteringCostSchema =
  topicClusteringCostSchemaDefinition;

export type TopicClusteringCost = z.infer<typeof topicClusteringCostSchema>;

const topicClusteringResponseSchemaDefinition = z.object({
  topics: z.array(topicClusteringTopicSchema),
  subtopics: z.array(topicClusteringSubtopicSchema),
  traces: z.array(topicClusteringTraceTopicMapSchema),
  cost: topicClusteringCostSchema,
});
export interface TopicClusteringResponseSchema extends Named<
  typeof topicClusteringResponseSchemaDefinition
> {}
export const topicClusteringResponseSchema: TopicClusteringResponseSchema =
  topicClusteringResponseSchemaDefinition;

export type TopicClusteringResponse = z.infer<typeof topicClusteringResponseSchema>;
