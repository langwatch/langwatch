import { z } from "zod";

/** One `system.mutations` row for a materialisation the trace module waits on. */
export const materialisationMutationSchema = z.object({
  mutationId: z.string(),
  isDone: z.boolean(),
  partsToDo: z.number().int().nonnegative(),
  /** Empty while the mutation has not failed. */
  latestFailReason: z.string(),
});

export type MaterialisationMutation = z.infer<typeof materialisationMutationSchema>;

/** The `trace_analytics` columns goose 00126 copies out of `Attributes`, in its order. */
export const ANALYTICS_METADATA_COLUMNS = [
  "MetadataOutputAction",
  "MetadataOutcome",
  "MetadataSentToReview",
  "MetadataDocumentType",
  "MetadataFlow",
  "MetadataLanguage",
  "MetadataSegment",
  "MetadataTeam",
  "MetadataTopic",
] as const;

/**
 * The shared ClickHouse target's progress materialising goose 00103's `idx_updated_at` and
 * goose 00126's metadata columns.
 */
export abstract class TraceIndexMaterialisationRepository {
  /** Newest first; empty once ClickHouse pruned the finished mutation, or before one was issued. */
  abstract findUpdatedAtIndexMutations(): Promise<MaterialisationMutation[]>;
  /** Starts the materialisation again; a no-op on a table without the index. */
  abstract materialiseUpdatedAtIndex(): Promise<void>;
  /** Newest first, as for the index: mutations whose command stores all nine metadata columns. */
  abstract findAnalyticsMetadataColumnMutations(): Promise<MaterialisationMutation[]>;
  /** Active `trace_analytics` parts that do not yet store every metadata column on disk. */
  abstract countPartsMissingAnalyticsMetadataColumns(): Promise<number>;
  /** Starts storing the metadata columns in every part again, as one mutation. */
  abstract materialiseAnalyticsMetadataColumns(): Promise<void>;
}
