import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

import {
  TOPIC_CLUSTERING_RUN_HISTORY_LIMIT,
  TOPIC_CLUSTERING_TRIGGER,
} from "./topic-clustering.constants.ts";

const topicSchemaDefinition = z
  .object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable(),
    automaticallyGenerated: z.boolean(),
  })
  .strict();
export interface TopicSchema extends Named<typeof topicSchemaDefinition> {}
export const topicSchema: TopicSchema = topicSchemaDefinition;

export type Topic = z.infer<typeof topicSchema>;

const topicProjectInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
export interface TopicProjectInputSchema extends Named<typeof topicProjectInputSchemaDefinition> {}
export const topicProjectInputSchema: TopicProjectInputSchema = topicProjectInputSchemaDefinition;

/** An aggregate's facets name its members' topics, so the lookup spans every project read. */
const topicNamesInputSchemaDefinition = z
  .object({
    projectIds: z.array(z.string().min(1)),
    ids: z.array(z.string()),
  })
  .strict();
export interface TopicNamesInputSchema extends Named<typeof topicNamesInputSchemaDefinition> {}
export const topicNamesInputSchema: TopicNamesInputSchema = topicNamesInputSchemaDefinition;

const topicClusteringRequestInputSchemaDefinition = topicProjectInputSchema.safeExtend({
  occurredAt: z.number(),
  trigger: z.enum([TOPIC_CLUSTERING_TRIGGER.MANUAL, TOPIC_CLUSTERING_TRIGGER.BOOTSTRAP]),
  requestedByUserId: z.string().optional(),
});
export interface TopicClusteringRequestInputSchema extends Named<
  typeof topicClusteringRequestInputSchemaDefinition
> {}
export const topicClusteringRequestInputSchema: TopicClusteringRequestInputSchema =
  topicClusteringRequestInputSchemaDefinition;

export type TopicProjectInput = z.infer<typeof topicProjectInputSchema>;
export type TopicNamesInput = z.infer<typeof topicNamesInputSchema>;
export type TopicClusteringRequestInput = z.infer<typeof topicClusteringRequestInputSchema>;

const topicClusteringStatusSchemaDefinition = z
  .object({
    lastRequestedAt: z.number().nullable(),
    lastRequestTrigger: z.string().nullable(),
    lastRunAt: z.number().nullable(),
    lastRunOutcome: z.string().nullable(),
    lastRunMode: z.string().nullable(),
    lastRunSkippedReason: z.string().nullable(),
    lastRunErrorCode: z.string().nullable(),
    isLastRunErrorUserActionable: z.boolean(),
    lastRunTracesProcessed: z.number().int().nonnegative(),
    lastRunTopicsCount: z.number().int().nonnegative(),
    lastRunSubtopicsCount: z.number().int().nonnegative(),
    isInProgress: z.boolean(),
    isRunInFlight: z.boolean(),
    nextRunAt: z.number().nullable(),
  })
  .strict();
export interface TopicClusteringStatusSchema extends Named<
  typeof topicClusteringStatusSchemaDefinition
> {}
export const topicClusteringStatusSchema: TopicClusteringStatusSchema =
  topicClusteringStatusSchemaDefinition;

export type TopicClusteringStatus = z.infer<typeof topicClusteringStatusSchema>;

const topicClusteringRunHistoryEntrySchemaDefinition = z
  .object({
    runId: z.string(),
    trigger: z.string(),
    startedAt: z.number(),
    finishedAt: z.number().nullable(),
    outcome: z.string(),
    mode: z.string().nullable(),
    skippedReason: z.string().nullable(),
    errorCode: z.string().nullable(),
    isErrorUserActionable: z.boolean(),
    // These are projection counters. Keep the read contract numeric (rather
    // than adding a new rejection policy to this compatibility surface).
    tracesProcessed: z.number(),
    topicsCount: z.number(),
    subtopicsCount: z.number(),
    pages: z.number(),
  })
  .strict();
export interface TopicClusteringRunHistoryEntrySchema extends Named<
  typeof topicClusteringRunHistoryEntrySchemaDefinition
> {}
export const topicClusteringRunHistoryEntrySchema: TopicClusteringRunHistoryEntrySchema =
  topicClusteringRunHistoryEntrySchemaDefinition;

export type TopicClusteringRunHistoryEntry = z.infer<typeof topicClusteringRunHistoryEntrySchema>;

/**
 * One page of the retained run history, newest first. The cursor is the run id of the previous
 * page's last entry, so a run finishing between two reads never shifts what the next page returns.
 */
const topicClusteringRunHistoryPageInputSchemaDefinition = topicProjectInputSchema.safeExtend({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(TOPIC_CLUSTERING_RUN_HISTORY_LIMIT).default(20),
});
export interface TopicClusteringRunHistoryPageInputSchema extends Named<
  typeof topicClusteringRunHistoryPageInputSchemaDefinition
> {}
export const topicClusteringRunHistoryPageInputSchema: TopicClusteringRunHistoryPageInputSchema =
  topicClusteringRunHistoryPageInputSchemaDefinition;
export type TopicClusteringRunHistoryPageInput = z.infer<
  typeof topicClusteringRunHistoryPageInputSchema
>;

/**
 * `cursor_expired` means the run the cursor names is no longer in the retained history (it keeps
 * only the newest runs): the reader restarts from the first page. `hasMore` never reaches runs
 * the projection has already discarded.
 */
const topicClusteringRunHistoryPageSchemaDefinition = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("page"),
      entries: topicClusteringRunHistoryEntrySchema.array(),
      hasMore: z.boolean(),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  z.object({ outcome: z.literal("cursor_expired") }).strict(),
]);
export interface TopicClusteringRunHistoryPageSchema extends Named<
  typeof topicClusteringRunHistoryPageSchemaDefinition
> {}
export const topicClusteringRunHistoryPageSchema: TopicClusteringRunHistoryPageSchema =
  topicClusteringRunHistoryPageSchemaDefinition;
export type TopicClusteringRunHistoryPage = z.infer<typeof topicClusteringRunHistoryPageSchema>;

/** What a manual clustering trigger did, which is not always "started a run". */
const topicClusteringTriggerResultSchemaDefinition = z.union([
  z.object({ started: z.literal(true) }).strict(),
  z.object({ started: z.literal(false), reason: z.literal("already_running") }).strict(),
]);
export interface TopicClusteringTriggerResultSchema extends Named<
  typeof topicClusteringTriggerResultSchemaDefinition
> {}
export const topicClusteringTriggerResultSchema: TopicClusteringTriggerResultSchema =
  topicClusteringTriggerResultSchemaDefinition;
export type TopicClusteringTriggerResult = z.infer<typeof topicClusteringTriggerResultSchema>;

/** The named topic and subtopic counts the trace filters render. */
const namedTopicCountsSchemaDefinition = z.object({
  topicCounts: z.array(z.object({ id: z.string(), name: z.string(), count: z.number() })),
  subtopicCounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
      parentId: z.string().nullable().optional(),
    }),
  ),
});
export interface NamedTopicCountsSchema extends Named<typeof namedTopicCountsSchemaDefinition> {}
export const namedTopicCountsSchema: NamedTopicCountsSchema = namedTopicCountsSchemaDefinition;
export type NamedTopicCounts = z.infer<typeof namedTopicCountsSchema>;

/** The project's conversation topics, and what the last clustering run did. */
export interface TopicApi {
  getAll(input: TopicProjectInput): Promise<Topic[]>;
  getNamesByIds(input: TopicNamesInput): Promise<Map<string, string>>;
  getClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatus>;
  getClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]>;
  /** The same retained history a page at a time, newest first, beside the full read. */
  getClusteringRunHistoryPage(
    input: TopicClusteringRunHistoryPageInput,
  ): Promise<TopicClusteringRunHistoryPage>;
  /** Asks the project's clustering process for a run; ports main's `requestClustering`. */
  requestClustering(input: TopicClusteringRequestInput): Promise<void>;
  /** Starts one manual run, preserving the in-flight guard and caller attribution. */
  triggerTopicClustering(input: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<TopicClusteringTriggerResult>;
}

export const TopicApi = moduleApi<TopicApi>()("topic");
