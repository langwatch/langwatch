import type {
  PinnedTrace,
  PinTraceInput,
  ResolvedRetention,
  RetentionCategory,
  RetentionPolicy,
  ScopeAssignment,
  UnpinTraceInput,
} from "./data-retention";

export class ScopeTargetNotFoundError extends Error {
  readonly name = "ScopeTargetNotFoundError" as const;
}

export abstract class DataRetentionService {
  abstract resolve(projectId: string): Promise<ResolvedRetention | null>;
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
  abstract pin(input: PinTraceInput): Promise<PinnedTrace>;
  abstract unpin(input: UnpinTraceInput): Promise<void>;
  abstract autoPin(input: UnpinTraceInput): Promise<PinnedTrace>;
  abstract autoUnpin(input: UnpinTraceInput): Promise<void>;
  abstract isPinned(input: UnpinTraceInput): Promise<boolean>;
  abstract tryGetPin(input: UnpinTraceInput): Promise<PinnedTrace | null>;
  abstract listByProject(input: { projectId: string }): Promise<PinnedTrace[]>;
  abstract getPinnedTraceIds(input: { projectId: string }): Promise<string[]>;
}
