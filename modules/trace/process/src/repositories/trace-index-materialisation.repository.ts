import { z } from "zod";

/** One `system.mutations` row for the `idx_updated_at` materialisation on `trace_summaries`. */
export const updatedAtIndexMutationSchema = z.object({
  mutationId: z.string(),
  isDone: z.boolean(),
  partsToDo: z.number().int().nonnegative(),
  /** Empty while the mutation has not failed. */
  latestFailReason: z.string(),
});

export type UpdatedAtIndexMutation = z.infer<typeof updatedAtIndexMutationSchema>;

/** The shared ClickHouse target's progress materialising goose 00103's `idx_updated_at`. */
export abstract class TraceIndexMaterialisationRepository {
  /** Newest first; empty once ClickHouse pruned the finished mutation, or before one was issued. */
  abstract findUpdatedAtIndexMutations(): Promise<UpdatedAtIndexMutation[]>;
  /** Starts the materialisation again; a no-op on a table without the index. */
  abstract materialiseUpdatedAtIndex(): Promise<void>;
}
