import { featureApi } from "@langwatch/runtime-composition/contract";
import type {
  KillRetroactiveMutationInput,
  PinTraceInput,
  PinnedTrace,
  RetroactiveMutationProgress,
  RetroactiveMutationProjectInput,
  RetroactiveRetentionUpdateInput,
  ResolvedRetention,
  RetentionCategory,
  RetentionPolicy,
  ScopeAssignment,
  StorageMeterTenantInput,
  StorageMeterTenantsInput,
  UnpinTraceInput,
} from "./data-retention.ts";

/** The callable server boundary for retention policy, pins, and metering. */
export interface DataRetentionApi {
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention>;
  getRetentionDays(input: { projectId: string; category: RetentionCategory }): Promise<number>;
  previewScopeRemoval(input: { scope: ScopeAssignment }): Promise<ResolvedRetention>;
  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]>;
  tryGetPolicyById(input: { id: string }): Promise<RetentionPolicy | null>;
  setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy>;
  removeForScope(input: { scope: ScopeAssignment; category: RetentionCategory }): Promise<void>;
  pin(input: PinTraceInput): Promise<PinnedTrace>;
  unpin(input: UnpinTraceInput): Promise<void>;
  autoPin(input: UnpinTraceInput): Promise<PinnedTrace>;
  autoUnpin(input: UnpinTraceInput): Promise<void>;
  isPinned(input: UnpinTraceInput): Promise<boolean>;
  tryGetPin(input: UnpinTraceInput): Promise<PinnedTrace | null>;
  listByProject(input: { projectId: string }): Promise<PinnedTrace[]>;
  getPinnedTraceIds(input: { projectId: string }): Promise<string[]>;
  triggerRetroactiveUpdate(input: RetroactiveRetentionUpdateInput): Promise<{ tables: string[] }>;
  getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]>;
  killRetroactiveMutation(input: KillRetroactiveMutationInput): Promise<void>;
  getTotalStorageBytes(input: StorageMeterTenantInput): Promise<number>;
  getTotalStorageBytesForTenants(input: StorageMeterTenantsInput): Promise<number>;
}

export const DataRetentionApi = featureApi<DataRetentionApi>("data-retention");
