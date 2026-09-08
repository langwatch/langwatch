import type {
  RetentionCategory,
  RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";

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
  getMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]>;
  killMutation(input: { projectId: string; mutationId: string }): Promise<void>;
}
