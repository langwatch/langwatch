import { z } from "zod";

export const topicSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  automaticallyGenerated: z.boolean(),
}).strict();

export type Topic = z.infer<typeof topicSchema>;

export const topicProjectInputSchema = z.object({
  projectId: z.string().min(1),
}).strict();

export const topicNamesInputSchema = topicProjectInputSchema.extend({
  ids: z.array(z.string()),
});

export type TopicProjectInput = z.infer<typeof topicProjectInputSchema>;
export type TopicNamesInput = z.infer<typeof topicNamesInputSchema>;

export const topicClusteringStatusSchema = z.object({
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
}).strict();

export type TopicClusteringStatus = z.infer<
  typeof topicClusteringStatusSchema
>;

export const topicClusteringRunHistoryEntrySchema = z.object({
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
}).strict();

export type TopicClusteringRunHistoryEntry = z.infer<
  typeof topicClusteringRunHistoryEntrySchema
>;
