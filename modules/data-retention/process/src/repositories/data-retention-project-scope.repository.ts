import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { z } from "zod";

/** Where one project sits, as data retention last folded project's facts. */
export const dataRetentionProjectScopeStateSchema = z.object({
  projectId: z.string(),
  organizationId: z.string(),
  /** Null until a fact naming the team folds (a created fact before 2026-10-06 names none). */
  teamId: z.string().nullable(),
  teamRecordedAt: z.number().nullable(),
  /** An archived project keeps resolving: its stored data still expires under the rules. */
  archivedAt: z.number().nullable(),
  LastEventOccurredAt: z.number(),
});
export type DataRetentionProjectScopeState = z.infer<typeof dataRetentionProjectScopeStateSchema>;

/** The peer fold's version; a change re-folds the lane by a projection replay. */
export const DATA_RETENTION_PROJECT_SCOPE_PROJECTION_VERSION = "2026-10-08" as const;

/**
 * Data retention's fold of project's lifecycle facts, one row per project (Alex, 2026-10-06,
 * Q151 Q1): the peer fold's store, and the project lists a scope's cache invalidation reads.
 */
export abstract class DataRetentionProjectScopeRepository implements FoldProjectionStore<DataRetentionProjectScopeState> {
  abstract get(aggregateId: string): Promise<FoldStateRead<DataRetentionProjectScopeState>>;
  abstract store(
    state: DataRetentionProjectScopeState,
    context: ProjectionStoreContext,
  ): Promise<void>;
  /** Every project folded under the organization, or under one team of it; archived included. */
  abstract findProjectIds(input: { organizationId: string; teamId?: string }): Promise<string[]>;
}
