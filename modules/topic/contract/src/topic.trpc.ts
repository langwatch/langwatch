/**
 * Every `topics.*` procedure, declared once. The browser reads the same names
 * and schemas as its client's types; the server binds a permission and a
 * handler to each and repeats nothing.
 */

import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import { TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES } from "./topic-clustering.constants.ts";
import {
  topicClusteringRunHistoryEntrySchema,
  topicClusteringStatusSchema,
  topicSchema,
} from "./topic.ts";

/** The project every topic read is scoped to. */
export const topicProjectScopeSchema = z.object({ projectId: z.string() });

export const topicTrpc = defineTrpcContract("topics")
  .query("getAll")
  .withInput(topicProjectScopeSchema)
  .withOutput(topicSchema.array())

  .query("getClusteringStatus", { invalidatedBy: TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES })
  .withInput(topicProjectScopeSchema)
  .withOutput(topicClusteringStatusSchema)

  .query("getClusteringRunHistory", { invalidatedBy: TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES })
  .withInput(topicProjectScopeSchema)
  .withOutput(topicClusteringRunHistoryEntrySchema.array())
  .build();
