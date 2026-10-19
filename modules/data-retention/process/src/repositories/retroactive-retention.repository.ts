import type {
  RetentionCategory,
  RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { z } from "zod";

/** One `system.mutations` row for the event log's keep-forever rewrite on one target. */
export const keepForeverRewriteSchema = z.object({
  mutationId: z.string(),
  isDone: z.boolean(),
  partsToDo: z.number().int().nonnegative(),
  /** Empty while the rewrite has not failed. */
  latestFailReason: z.string(),
});

export type KeepForeverRewrite = z.infer<typeof keepForeverRewriteSchema>;

/** A ClickHouse target: the shared one names no organization, a private dataplane names its own. */
export type ClickHouseTarget = Readonly<{ organizationId?: string }>;

/**
 * The rewrite of rows already captured. Backed by ClickHouse, which the process
 * resolves per tenant, so it is not part of the Postgres repository bundle.
 */
export interface RetroactiveRetentionRepository {
  triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }>;
  findMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]>;
  killMutation(input: { projectId: string; mutationId: string }): Promise<void>;
  /** The shared target, then each private dataplane this process routes to. */
  keepForeverTargets(): readonly ClickHouseTarget[];
  /** The event log's keep-forever rewrites on one target, newest first. */
  findKeepForeverRewrites(input: ClickHouseTarget): Promise<KeepForeverRewrite[]>;
  /** Re-stamps every never-expiring event-log row on one target to be kept forever. */
  startKeepForeverRewrite(input: ClickHouseTarget): Promise<void>;
}
