import type {
  KillRetroactiveMutationInput,
  PinnedTrace,
  PinTraceInput,
  RetroactiveMutationProjectInput,
  RetroactiveMutationProgress,
  RetroactiveRetentionUpdateInput,
  ResolvedRetention,
  RetentionCategory,
  RetentionPolicy,
  ScopeAssignment,
  StorageMeterTenantInput,
  StorageMeterTenantsInput,
  UnpinTraceInput,
} from "./data-retention";

export class ScopeTargetNotFoundError extends Error {
  readonly name = "ScopeTargetNotFoundError" as const;
}

export class RetroactiveMutationInProgressError extends Error {
  readonly name = "RetroactiveMutationInProgressError" as const;

  constructor(readonly blocked: RetroactiveMutationProgress[]) {
    const summary = blocked
      .map((mutation) => `${mutation.table} (${mutation.mutationId})`)
      .join(", ");
    super(
      `Retroactive update already in progress for: ${summary}. ` +
        "Wait for completion or kill the listed mutation(s) before starting another.",
    );
  }
}

export class DataRetentionBackendUnavailableError extends Error {
  readonly name = "DataRetentionBackendUnavailableError" as const;

  constructor() {
    super("ClickHouse not available");
  }
}

export abstract class DataRetentionService {
  abstract getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention>;
  abstract getRetentionDays(input: {
    projectId: string;
    category: RetentionCategory;
  }): Promise<number>;
  abstract previewScopeRemoval(input: { scope: ScopeAssignment }): Promise<ResolvedRetention>;
  abstract listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]>;
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
  abstract triggerRetroactiveUpdate(
    input: RetroactiveRetentionUpdateInput,
  ): Promise<{ tables: string[] }>;
  abstract getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]>;
  abstract killRetroactiveMutation(input: KillRetroactiveMutationInput): Promise<void>;
  abstract getTotalStorageBytes(input: StorageMeterTenantInput): Promise<number>;
  abstract getTotalStorageBytesForTenants(input: StorageMeterTenantsInput): Promise<number>;
}
