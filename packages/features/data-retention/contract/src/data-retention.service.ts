import type {
  ResolvedRetention,
  RetentionCategory,
  RetentionPolicy,
  ScopeAssignment,
} from "./data-retention";

export abstract class DataRetentionService {
  abstract getResolvedForProject(input: {
    projectId: string;
  }): Promise<ResolvedRetention>;
  abstract getRetentionDays(input: {
    projectId: string;
    category: RetentionCategory;
  }): Promise<number>;
  abstract previewScopeRemoval(input: {
    scope: ScopeAssignment;
  }): Promise<ResolvedRetention>;
  abstract listOrganizationRules(input: {
    organizationId: string;
  }): Promise<RetentionPolicy[]>;
  abstract tryGetPolicyById(input: { id: string }): Promise<RetentionPolicy | null>;
  abstract setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy>;
  abstract removeForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void>;
}
