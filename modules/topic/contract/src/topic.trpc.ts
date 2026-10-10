/**
 * Every `topics.*` procedure, declared once. The browser reads the same names
 * and schemas as its client's types; the server binds a permission and a
 * handler to each and repeats nothing.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { traceFilterInputSchema } from "@langwatch/trace-contract";
import { z } from "zod";

import { TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES } from "./topic-clustering.constants.ts";
import {
  topicClusteringRunHistoryEntrySchema,
  topicClusteringStatusSchema,
  namedTopicCountsSchema,
  topicClusteringTriggerResultSchema,
  topicSchema,
} from "./topic.ts";

/** The project every topic read is scoped to. */
const topicProjectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface TopicProjectScopeSchema extends Named<typeof topicProjectScopeSchemaDefinition> {}
export const topicProjectScopeSchema: TopicProjectScopeSchema = topicProjectScopeSchemaDefinition;

export const topicTrpc = defineTrpcContract("topics")
  .query("getAll")
  .withInput(topicProjectScopeSchema)
  .withOutput(topicSchema.array())

  /** Moved from `traces.getTopicCounts`: trace counts the buckets, topic names them. */
  .query("getTopicCounts")
  .withInput(traceFilterInputSchema)
  .withOutput(namedTopicCountsSchema)

  .query("getClusteringStatus", { invalidatedBy: TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES })
  .withInput(topicProjectScopeSchema)
  .withOutput(topicClusteringStatusSchema)

  .query("getClusteringRunHistory", { invalidatedBy: TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES })
  .withInput(topicProjectScopeSchema)
  .withOutput(topicClusteringRunHistoryEntrySchema.array())

  .mutation("triggerTopicClustering")
  .withInput(topicProjectScopeSchema)
  .withOutput(topicClusteringTriggerResultSchema)
  .build();
