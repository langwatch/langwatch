import type {
  AuthzGetDecisionInput,
  AuthzGetProjectAnyDecisionInput,
  AuthzPermission,
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
  DeclaredScopeTier,
  PermissionDecision,
  PermissionScopeArg,
  TierOfScopeArg,
} from "@langwatch/authorization";
import type { Instant } from "@langwatch/time";

import type { AuthzFindPermissionsBeyondCallerInput } from "./authz-grants-rest.schemas.ts";
import type {
  AuthzAccessBreakdownInput,
  AuthzAccessBreakdownOutput,
  AuthzLegacyAccessNoticeInput,
  AuthzListManagedBindingsForOrganizationInput,
  AuthzListManagedBindingsForOrganizationOutput,
  AuthzListManagedBindingsForUserInput,
  AuthzListManagedBindingsForUserOutput,
} from "./authz.grant-management.ts";
import type {
  ApiKeyPermissionCheck,
  ApiKeyProjectDecision,
  AuthzAccessBindingsOutput,
  AuthzBindingForSynthesis,
  AuthzCanAnyByIdsInput,
  AuthzCanAnyByIdsOutput,
  AuthzCanBatchByIdsInput,
  AuthzCanBatchByIdsOutput,
  AuthzCanBatchPermissionsByIdsInput,
  AuthzCanBatchPermissionsByIdsOutput,
  AuthzCheckByIdsInput,
  AuthzCheckByIdsOutput,
  AuthzCanInput,
  AuthzCheckDetailedOutput,
  AuthzCheckInput,
  AuthzCustomRole,
  AuthzFindRolePermissionsInput,
  AuthzRolePermissions,
  AuthzEffectivePermissionsInput,
  AuthzEffectivePermissionsOutput,
  AuthzExplainDecisionInput,
  AuthzExplainDecisionOutput,
  AuthzGetApiKeyProjectDecisionInput,
  AuthzListBindingsForSynthesisInput,
  AuthzListApiKeyBindingsInput,
  AuthzListGroupBindingsInput,
  AuthzListOrganizationBindingsInput,
  AuthzListScopeBindingsInput,
  AuthzListTeamMemberBindingsInput,
  AuthzListUserAndGroupBindingsInput,
  AuthzListUserBindingsInput,
  AuthzPermissionByIdsInput,
  AuthzRequireProjectPermissionInput,
  AuthzResolveScopeInput,
  AuthzTeamMemberBinding,
} from "./authz.queries.ts";
import type { AuthzPrincipalRef, AuthzScopeRef, Authorized } from "./authz.ts";
import type * as authzModule from "./authz.ts";

/**
 * The complete portable read and decision capability. Concrete server
 * implementations own collection, persistence routing, caching, and logging.
 */
export abstract class AuthzService {
  /**
   * Subclass-only witness constructor. Keeping it protected on the capability
   * lets the concrete service mint after an allow without publishing a free
   * factory or package subpath that ordinary callers could invoke.
   */
  protected mintAuthorizationWitness<
    Tier extends DeclaredScopeTier,
    Permission extends AuthzPermission,
  >({
    tier,
    id,
    permission,
  }: {
    tier: Tier;
    id: string;
    permission: Permission;
  }): Authorized<Tier, Permission> {
    return {
      permission,
      scope: { tier, id },
    } as Authorized<Tier, Permission>;
  }

  abstract check(args: AuthzCheckInput): Promise<authzModule.AuthzDecision>;

  abstract checkDetailed(args: AuthzCheckInput): Promise<AuthzCheckDetailedOutput>;

  abstract can(args: AuthzCanInput): Promise<boolean>;

  /** The only public operation that returns an authorization witness. */
  abstract authorize<Tier extends DeclaredScopeTier, Permission extends AuthzPermission>(args: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
  }): Promise<Authorized<Tier, Permission>>;

  abstract effectivePermissions(
    args: AuthzEffectivePermissionsInput,
  ): Promise<AuthzEffectivePermissionsOutput>;

  abstract checkByIds(args: AuthzCheckByIdsInput): Promise<AuthzCheckByIdsOutput>;

  abstract canAnyByIds(args: AuthzCanAnyByIdsInput): Promise<AuthzCanAnyByIdsOutput>;

  abstract canBatchByIds(args: AuthzCanBatchByIdsInput): Promise<AuthzCanBatchByIdsOutput>;

  /**
   * MANY permissions across many scopes in one organization, off ONE grant
   * collection - the api-key project ceiling asks two permissions of every
   * project, and two single-permission batches would collect it twice.
   */
  abstract canBatchPermissionsByIds(
    args: AuthzCanBatchPermissionsByIdsInput,
  ): Promise<AuthzCanBatchPermissionsByIdsOutput>;

  abstract getScope(args: AuthzResolveScopeInput): Promise<AuthzScopeRef>;

  /** The listed permissions the caller does not hold at that scope; empty when all are held. */
  abstract findPermissionsBeyondCaller(
    args: AuthzFindPermissionsBeyondCallerInput,
  ): Promise<string[]>;

  /** Refuses mixed scope ids that do not resolve to one organization. */
  abstract checkScopeLineage(args: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult>;

  abstract explainDecision(args: AuthzExplainDecisionInput): Promise<AuthzExplainDecisionOutput>;

  // Composed compatibility capability replacing the app PermissionsService.
  abstract getDecision(args: AuthzGetDecisionInput): Promise<PermissionDecision>;

  abstract getProjectAnyDecision(
    args: AuthzGetProjectAnyDecisionInput,
  ): Promise<PermissionDecision>;

  abstract hasPermission<Permission extends AuthzPermission>(
    check: {
      userId: string;
      permission: Permission;
    } & PermissionScopeArg<Permission>,
  ): Promise<boolean>;

  abstract authorizePermission<
    Permission extends AuthzPermission,
    ScopeArg extends PermissionScopeArg<Permission>,
  >(
    check: { userId: string; permission: Permission } & ScopeArg,
  ): Promise<Authorized<TierOfScopeArg<ScopeArg>, Permission>>;

  abstract authorizeProjectPermission(args: AuthzRequireProjectPermissionInput): Promise<void>;

  abstract hasApiKeyPermission(args: ApiKeyPermissionCheck): Promise<boolean>;

  abstract getApiKeyProjectDecision(
    args: AuthzGetApiKeyProjectDecisionInput,
  ): Promise<ApiKeyProjectDecision>;

  // Access listing is part of this capability, not a public repository.
  abstract listUserBindings(args: AuthzListUserBindingsInput): Promise<AuthzAccessBindingsOutput>;

  abstract listOrganizationBindings(
    args: AuthzListOrganizationBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listUserAndGroupBindings(
    args: AuthzListUserAndGroupBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listScopeBindings(args: AuthzListScopeBindingsInput): Promise<AuthzAccessBindingsOutput>;

  abstract listGroupBindings(args: AuthzListGroupBindingsInput): Promise<AuthzAccessBindingsOutput>;

  abstract listApiKeyBindings(
    args: AuthzListApiKeyBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listTeamMemberBindings(
    args: AuthzListTeamMemberBindingsInput,
  ): Promise<Map<string, AuthzTeamMemberBinding[]>>;

  abstract listBindingsForSynthesis(
    args: AuthzListBindingsForSynthesisInput,
  ): Promise<AuthzBindingForSynthesis[]>;

  abstract listUserCreatedRoles(
    args: AuthzListOrganizationBindingsInput,
  ): Promise<AuthzCustomRole[]>;

  abstract findRolePermissions(
    args: AuthzFindRolePermissionsInput,
  ): Promise<AuthzRolePermissions[]>;

  abstract wouldFirstBindingDisableLegacyAccess(
    args: AuthzLegacyAccessNoticeInput,
  ): Promise<boolean>;

  abstract listManagedBindingsForUser(
    args: AuthzListManagedBindingsForUserInput,
  ): Promise<AuthzListManagedBindingsForUserOutput>;

  abstract listManagedBindingsForOrganization(
    args: AuthzListManagedBindingsForOrganizationInput,
  ): Promise<AuthzListManagedBindingsForOrganizationOutput>;

  abstract getAccessBreakdown(args: AuthzAccessBreakdownInput): Promise<AuthzAccessBreakdownOutput>;

  /**
   * Temporary rollout boundary for legacy callers that still own their pre-engine fallback.
   * Persistence and migration state remain private.
   */
  abstract isOnEngine(args: AuthzListOrganizationBindingsInput): Promise<boolean>;

  /** Finalized migration time for compatibility facts, or null before cutover. */
  abstract findEngineCutoverAt(args: AuthzListOrganizationBindingsInput): Promise<Instant | null>;
}

/** Useful structural union for adapters that accept either typed path form. */
export type AuthzPermissionCapabilityInput = AuthzPermissionByIdsInput | AuthzGetDecisionInput;
