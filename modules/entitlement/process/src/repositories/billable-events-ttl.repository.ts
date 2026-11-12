import { z } from "zod";

/** One `system.mutations` row of a `billable_events` TTL materialisation. */
export const ttlMutationSchema = z.object({
  mutationId: z.string(),
  isDone: z.boolean(),
  partsToDo: z.number().int().nonnegative(),
  /** Empty while the mutation has not failed. */
  latestFailReason: z.string(),
});
export type TtlMutation = z.infer<typeof ttlMutationSchema>;

/** The `billable_events` delete TTL (goose 00128) applied to parts written before it. */
export abstract class BillableEventsTtlRepository {
  /** Newest first; empty before one was started or once ClickHouse pruned the finished one. */
  abstract findTtlMutations(): Promise<TtlMutation[]>;
  /** Starts applying the table's TTL to every existing part, as one mutation. */
  abstract materialiseTtl(): Promise<void>;
}
