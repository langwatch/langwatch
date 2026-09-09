/**
 * Every `annotation.*` procedure, declared once: its name, its kind, what it
 * takes and what it answers. The server binds a permission and a handler to a
 * name declared here; the browser reads the same names and schemas as types.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  annotationQueueDetailSchema,
  annotationQueueItemsDeletedSchema,
  annotationQueueListEntrySchema,
  annotationQueuePendingCountSchema,
  annotationQueueRecordSchema,
  annotationWithFullUserSchema,
  annotationWithUserSummarySchema,
} from "./annotation-response.schemas.ts";
import {
  annotationOptimizedQueuesSchema,
  annotationQueueItemWithTraceSchema,
} from "./annotation-review.schemas.ts";
import { annotationQueueItemSchema } from "./annotation-queue.schemas.ts";
import { annotationSchema } from "./annotation.schemas.ts";
import {
  annotationApiAnnotationScopeSchema,
  annotationApiByTraceIdInputSchema,
  annotationApiByTraceIdsInputSchema,
  annotationApiCreateInputSchema,
  annotationApiCreateQueueItemInputSchema,
  annotationApiDeleteQueueItemsInputSchema,
  annotationApiListAllInputSchema,
  annotationApiMarkQueueItemDoneInputSchema,
  annotationApiOptimizedQueuesInputSchema,
  annotationApiProjectScopeSchema,
  annotationApiQueueBySlugOrIdInputSchema,
  annotationApiQueueConfigurationInputSchema,
  annotationApiQueueListInputSchema,
  annotationApiUpdateInputSchema,
} from "./annotation-trpc.schemas.ts";

/** A badge count, for the reviewer's own work and for the Inbox. */
export const annotationCountSchema = z.object({ count: z.number() });

/** What a send to a queue did: `skipped` counts trace ids that no longer resolve. */
export const annotationQueuedTracesSchema = z.object({
  created: z.number(),
  skipped: z.number(),
});

export const annotationTrpc = defineTrpcContract("annotation")
  .mutation("create")
  .withInput(annotationApiCreateInputSchema)
  .withOutput(annotationSchema)

  .mutation("updateByTraceId")
  .withInput(annotationApiUpdateInputSchema)
  .withOutput(annotationSchema)

  /** Reads every comment on a trace unless the caller asks for trace-only comments. */
  .query("getByTraceId")
  .withInput(annotationApiByTraceIdInputSchema)
  .withOutput(annotationWithUserSummarySchema.array())

  /** Same contract as `getByTraceId`, for a page of traces. */
  .query("getByTraceIds")
  .withInput(annotationApiByTraceIdsInputSchema)
  .withOutput(annotationWithUserSummarySchema.array())

  .query("getById")
  .withInput(annotationApiAnnotationScopeSchema)
  .withOutput(annotationSchema)

  .mutation("deleteById")
  .withInput(annotationApiAnnotationScopeSchema)
  .withOutput(annotationSchema)

  /** Lists comments and their anchors for the project export. */
  .query("getAll")
  .withInput(annotationApiListAllInputSchema)
  .withOutput(annotationWithFullUserSchema.array())

  .mutation("createOrUpdateQueue")
  .withInput(annotationApiQueueConfigurationInputSchema)
  .withOutput(annotationQueueRecordSchema)

  .query("getQueues")
  .withInput(annotationApiQueueListInputSchema)
  .withOutput(annotationQueueListEntrySchema.array())

  .query("getQueueItems")
  .withInput(annotationApiProjectScopeSchema)
  .withOutput(annotationQueueItemWithTraceSchema.array())

  .query("getPendingItemsCount")
  .withInput(annotationApiProjectScopeSchema)
  .withOutput(annotationCountSchema)

  .query("getAssignedItemsCount")
  .withInput(annotationApiProjectScopeSchema)
  .withOutput(annotationCountSchema)

  .query("getQueueItemsCounts")
  .withInput(annotationApiProjectScopeSchema)
  .withOutput(annotationQueuePendingCountSchema.array())

  .mutation("createQueueItem")
  .withInput(annotationApiCreateQueueItemInputSchema)
  .withOutput(annotationQueuedTracesSchema)

  /** Removes only queue items the caller can reach. */
  .mutation("deleteQueueItems")
  .withInput(annotationApiDeleteQueueItemsInputSchema)
  .withOutput(annotationQueueItemsDeletedSchema)

  /** Marks only a queue item the caller can reach as reviewed. */
  .mutation("markQueueItemDone")
  .withInput(annotationApiMarkQueueItemDoneInputSchema)
  .withOutput(annotationQueueItemSchema)

  .query("getQueueBySlugOrId")
  .withInput(annotationApiQueueBySlugOrIdInputSchema)
  .withOutput(annotationQueueDetailSchema)

  .query("getOptimizedAnnotationQueues")
  .withInput(annotationApiOptimizedQueuesInputSchema)
  .withOutput(annotationOptimizedQueuesSchema)
  .build();
