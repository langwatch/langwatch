import { featureApi } from "@langwatch/runtime-composition";
import type { Authorized, AuthzDecision, AuthzPrincipalRef, AuthzScopeRef } from "./authz.ts";
import type * as Binding from "./authz.binding-management.ts";
import type * as Commands from "./authz.commands.ts";
import type * as Queries from "./authz.queries.ts";
import type { AuthzPermission } from "./registry.ts";
import type { BindingScopeTier } from "./vocabulary.ts";
import type { Instant } from "@langwatch/time";

export interface AuthzCaller {
  readonly id: string;
}
export type EffectivePermissions =
  | Readonly<{ scope: null; permissions: string[] }>
  | Readonly<{
      scope: Readonly<{ type: AuthzScopeRef["type"]; id: string }>;
      permissions: Queries.AuthzEffectivePermissionsOutput;
    }>;

/**
 * The complete callable authorization boundary.  This is deliberately a
 * structural interface: callers can use an installed AuthzApp without
 * receiving its services, repositories, or transport adapters.
 */
export interface AuthzApi {
  effectivePermissionsFor(
    input: Readonly<{ projectId?: string; organizationId?: string }>,
    by: AuthzCaller,
  ): Promise<EffectivePermissions>;
  check(args: Queries.AuthzCheckInput): Promise<AuthzDecision>;
  checkDetailed(args: Queries.AuthzCheckInput): Promise<Queries.AuthzCheckDetailedOutput>;
  can(args: Queries.AuthzCheckInput): Promise<boolean>;
  authorize<Tier extends BindingScopeTier, Permission extends AuthzPermission>(args: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
  }): Promise<Authorized<Tier, Permission>>;
  effectivePermissions(
    args: Queries.AuthzEffectivePermissionsInput,
  ): Promise<Queries.AuthzEffectivePermissionsOutput>;
  checkByIds(args: Queries.AuthzCheckByIdsInput): Promise<Queries.AuthzCheckByIdsOutput>;
  canAnyByIds(args: Queries.AuthzCanAnyByIdsInput): Promise<Queries.AuthzCanAnyByIdsOutput>;
  canBatchByIds(args: Queries.AuthzCanBatchByIdsInput): Promise<Queries.AuthzCanBatchByIdsOutput>;
  canBatchPermissionsByIds(
    args: Queries.AuthzCanBatchPermissionsByIdsInput,
  ): Promise<Queries.AuthzCanBatchPermissionsByIdsOutput>;
  tryResolveScope(args: Queries.AuthzResolveScopeInput): Promise<AuthzScopeRef | null>;
  checkScopeLineage(
    args: import("./authz-scope-lineage.ts").AuthzScopeLineageInput,
  ): Promise<import("./authz-scope-lineage.ts").AuthzScopeLineageResult>;
  explainDecision(
    args: Queries.AuthzExplainDecisionInput,
  ): Promise<Queries.AuthzExplainDecisionOutput>;
  getDecision(args: Queries.AuthzGetDecisionInput): Promise<Queries.PermissionDecision>;
  getProjectAnyDecision(
    args: Queries.AuthzGetProjectAnyDecisionInput,
  ): Promise<Queries.PermissionDecision>;
  hasPermission<Permission extends AuthzPermission>(
    check: {
      userId: string;
      permission: Permission;
    } & import("./declaration.ts").PermissionScopeArg<Permission>,
  ): Promise<boolean>;
  authorizePermission<
    Permission extends AuthzPermission,
    ScopeArg extends import("./declaration.ts").PermissionScopeArg<Permission>,
  >(
    check: { userId: string; permission: Permission } & ScopeArg,
  ): Promise<Authorized<import("./declaration.ts").TierOfScopeArg<ScopeArg>, Permission>>;
  authorizeProjectPermission(args: Queries.AuthzRequireProjectPermissionInput): Promise<void>;
  hasApiKeyPermission(args: Queries.ApiKeyPermissionCheck): Promise<boolean>;
  getApiKeyProjectDecision(
    args: Queries.AuthzGetApiKeyProjectDecisionInput,
  ): Promise<Queries.ApiKeyProjectDecision>;
  listUserBindings(
    args: Queries.AuthzListUserBindingsInput,
  ): Promise<Queries.AuthzAccessBindingsOutput>;
  listOrganizationBindings(
    args: Queries.AuthzListOrganizationBindingsInput,
  ): Promise<Queries.AuthzAccessBindingsOutput>;
  listUserAndGroupBindings(
    args: Queries.AuthzListUserAndGroupBindingsInput,
  ): Promise<Queries.AuthzAccessBindingsOutput>;
  listScopeBindings(
    args: Queries.AuthzListScopeBindingsInput,
  ): Promise<Queries.AuthzAccessBindingsOutput>;
  listGroupBindings(
    args: Queries.AuthzListGroupBindingsInput,
  ): Promise<Queries.AuthzAccessBindingsOutput>;
  listTeamMemberBindings(
    args: Queries.AuthzListTeamMemberBindingsInput,
  ): Promise<Map<string, Queries.AuthzTeamMemberBinding[]>>;
  listBindingsForSynthesis(
    args: Queries.AuthzListBindingsForSynthesisInput,
  ): Promise<Queries.AuthzBindingForSynthesis[]>;
  listUserCreatedRoles(
    args: Queries.AuthzListOrganizationBindingsInput,
  ): Promise<Queries.AuthzCustomRole[]>;
  wouldFirstBindingDisableLegacyAccess(
    args: Binding.AuthzLegacyAccessNoticeInput,
  ): Promise<boolean>;
  listManagedBindingsForUser(
    args: Binding.AuthzListManagedBindingsForUserInput,
  ): Promise<Binding.AuthzListManagedBindingsForUserOutput>;
  listManagedBindingsForOrganization(
    args: Binding.AuthzListManagedBindingsForOrganizationInput,
  ): Promise<Binding.AuthzListManagedBindingsForOrganizationOutput>;
  getAccessBreakdown(
    args: Binding.AuthzAccessBreakdownInput,
  ): Promise<Binding.AuthzAccessBreakdownOutput>;
  isOnEngine(args: Queries.AuthzListOrganizationBindingsInput): Promise<boolean>;
  tryGetEngineCutoverAt(args: Queries.AuthzListOrganizationBindingsInput): Promise<Instant | null>;
  attach(args: Commands.AuthzAttachGrantInput): Promise<Commands.AuthzBindingOutput>;
  update(args: Commands.AuthzUpdateGrantInput): Promise<void>;
  revoke(args: Commands.AuthzRevokeGrantInput): Promise<void>;
  replace(args: Commands.AuthzReplaceGrantInput): Promise<Commands.AuthzBindingOutput>;
  offboard(args: Commands.AuthzOffboardInput): Promise<Commands.AuthzOffboardOutput>;
  invalidateOrganization(args: { organizationId: string }): Promise<void>;
  attachBindings(
    args: Commands.AuthzAttachBindingsInput,
  ): Promise<Commands.AuthzAttachBindingsOutput>;
  attachResourceGrant(
    args: Commands.AuthzAttachResourceGrantInput,
  ): Promise<Commands.AuthzAttachResourceGrantOutput>;
  revokeResourceGrants(
    args: Commands.AuthzRevokeResourceGrantsInput,
  ): Promise<Commands.AuthzRevokeResourceGrantsOutput>;
  changeBindingRole(
    args: Commands.AuthzChangeBindingRoleInput,
  ): Promise<Commands.AuthzChangeBindingRoleOutput>;
  revokeBindings(
    args: Commands.AuthzRevokeBindingsInput,
  ): Promise<Commands.AuthzRevokeBindingsOutput>;
  revokeBindingsWhere(
    args: Commands.AuthzRevokeBindingsWhereInput,
  ): Promise<Commands.AuthzRevokeBindingsWhereOutput>;
  offboardMember(
    args: Commands.AuthzOffboardMemberInput,
  ): Promise<Commands.AuthzOffboardMemberOutput>;
  defineRole(args: Commands.AuthzDefineRoleInput): Promise<Commands.AuthzDefineRoleOutput>;
  deleteRole(args: Commands.AuthzDeleteRoleInput): Promise<Commands.AuthzDeleteRoleOutput>;
  createBinding(args: Binding.AuthzCreateBindingInput): Promise<Binding.AuthzCreateBindingOutput>;
  updateBinding(args: Binding.AuthzUpdateBindingInput): Promise<Binding.AuthzCreateBindingOutput>;
  deleteBinding(
    args: Binding.AuthzDeleteBindingInput,
  ): Promise<Binding.AuthzBindingMutationSuccess>;
  applyMemberBindings(
    args: Binding.AuthzApplyMemberBindingsInput,
  ): Promise<Binding.AuthzBindingMutationSuccess>;
  hasProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: import("./registry.ts").AuthzPermission;
  }): Promise<boolean>;
}

export const AuthzApi = featureApi<AuthzApi>("authz");
