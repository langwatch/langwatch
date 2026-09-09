import { moduleApi } from "@langwatch/runtime-composition";
import type {
  KillRetroactiveMutationInput,
  PinTraceInput,
  PinnedTrace,
  RetroactiveMutationProgress,
  RetroactiveMutationProjectInput,
  ResolvedRetention,
  RetentionCategory,
  RetentionPolicy,
  ScopeAssignment,
  StorageMeterTenantInput,
  StorageMeterTenantsInput,
  UnpinTraceInput,
} from "./data-retention.ts";
import type { RetentionPolicySnapshot, RetentionStorageUsage } from "./data-retention.snapshot.ts";

/**
 * The signed-in person a governed retention operation is decided for. Only the
 * id travels: the address the platform-operator allow-list is written in is
 * resolved server-side from it, never taken from the caller.
 */
export type RetentionCallerInput = { userId: string };

/** The callable server boundary for retention policy, pins, and metering. */
export interface DataRetentionApi {
  getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention>;
  getRetentionDays(input: { projectId: string; category: RetentionCategory }): Promise<number>;
  listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]>;
  /** The system write, for a plan change that resets an organization's window. */
  setForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy>;
  pin(input: PinTraceInput): Promise<PinnedTrace>;
  unpin(input: UnpinTraceInput): Promise<void>;
  autoPin(input: UnpinTraceInput): Promise<PinnedTrace>;
  autoUnpin(input: UnpinTraceInput): Promise<void>;
  isPinned(input: UnpinTraceInput): Promise<boolean>;
  tryGetPin(input: UnpinTraceInput): Promise<PinnedTrace | null>;
  listByProject(input: { projectId: string }): Promise<PinnedTrace[]>;
  getPinnedTraceIds(input: { projectId: string }): Promise<string[]>;
  getRetroactiveMutationProgress(
    input: RetroactiveMutationProjectInput,
  ): Promise<RetroactiveMutationProgress[]>;
  getTotalStorageBytes(input: StorageMeterTenantInput): Promise<number>;
  getTotalStorageBytesForTenants(input: StorageMeterTenantsInput): Promise<number>;

  /**
   * The retention settings surface. Each operation authorizes and plan-gates
   * the caller against the scope it acts on, never against a project id the
   * input also carries: the two can belong to different organizations.
   */
  getPolicySnapshot(
    input: { projectId: string } & RetentionCallerInput,
  ): Promise<RetentionPolicySnapshot>;
  getScopeStorageUsage(
    input: { projectId: string; scope: ScopeAssignment } & RetentionCallerInput,
  ): Promise<RetentionStorageUsage>;
  previewScopeRemoval(
    input: { scope: ScopeAssignment } & RetentionCallerInput,
  ): Promise<ResolvedRetention>;
  changeScopeRetention(
    input: {
      scope: ScopeAssignment;
      category: RetentionCategory;
      retentionDays: number;
    } & RetentionCallerInput,
  ): Promise<RetentionPolicy>;
  removeForScope(
    input: { scope: ScopeAssignment; category: RetentionCategory } & RetentionCallerInput,
  ): Promise<void>;
  /**
   * Rewrites the project's existing rows to the retention the cascade resolves,
   * never to a caller-supplied value: a `project:update` caller must not be
   * able to contract data to any number it names.
   */
  applyRetentionToExistingData(
    input: { projectId: string; category: RetentionCategory } & RetentionCallerInput,
  ): Promise<{ tables: string[]; appliedRetentionDays: number }>;
  killRetroactiveMutation(
    input: KillRetroactiveMutationInput & RetentionCallerInput,
  ): Promise<void>;
}

export const DataRetentionApi = moduleApi<DataRetentionApi>("data-retention");
