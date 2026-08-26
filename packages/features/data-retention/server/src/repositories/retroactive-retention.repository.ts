import type {
  RetentionCategory,
  RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";

export abstract class RetroactiveRetentionRepository {
  abstract triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }>;
  abstract getMutationProgress(input: {
    projectId: string;
  }): Promise<RetroactiveMutationProgress[]>;
  abstract killMutation(input: { projectId: string; mutationId: string }): Promise<void>;
}
