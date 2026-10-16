import { z } from "zod";

/** One `system.mutations` row for the `idx_session_id` materialisation on coding agent sessions. */
export const sessionIdIndexMutationSchema = z.object({
  mutationId: z.string(),
  isDone: z.boolean(),
  partsToDo: z.number().int().nonnegative(),
  /** Empty while the mutation has not failed. */
  latestFailReason: z.string(),
});

export type SessionIdIndexMutation = z.infer<typeof sessionIdIndexMutationSchema>;

/** The shared ClickHouse target's progress materialising goose 00110's `idx_session_id`. */
export abstract class CodingAgentSessionIndexMaterialisationRepository {
  /** Newest first; empty once ClickHouse pruned the finished mutation, or before one was issued. */
  abstract findSessionIdIndexMutations(): Promise<SessionIdIndexMutation[]>;
  /** Starts the materialisation again; a no-op on a table without the index. */
  abstract materialiseSessionIdIndex(): Promise<void>;
}
