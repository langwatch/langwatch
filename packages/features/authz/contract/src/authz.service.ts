import type { AuthzPrincipalRef, AuthzScopeRef, Authorized } from "./authz";
import type { PermissionScopeArg, TierOfScopeArg } from "./declaration";
import type { AuthzPermission } from "./registry";
import type { BindingScopeTier } from "./vocabulary";
import type {
  ApiKeyPermissionCheck,
  ApiKeyProjectDecision,
  AuthzAccessBindingsOutput,
  AuthzBindingForSynthesis,
  AuthzCanAnyByIdsInput,
  AuthzCanAnyByIdsOutput,
  AuthzCanBatchByIdsInput,
  AuthzCanBatchByIdsOutput,
  AuthzCheckByIdsInput,
  AuthzCheckByIdsOutput,
  AuthzCheckDetailedOutput,
  AuthzCheckInput,
  AuthzCustomRole,
  AuthzEffectivePermissionsInput,
  AuthzEffectivePermissionsOutput,
  AuthzExplainDecisionInput,
  AuthzExplainDecisionOutput,
  AuthzGetApiKeyProjectDecisionInput,
  AuthzGetDecisionInput,
  AuthzGetProjectAnyDecisionInput,
  AuthzListBindingsForSynthesisInput,
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
  PermissionDecision,
} from "./authz.queries";

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
    Tier extends BindingScopeTier,
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

  abstract check(
    args: AuthzCheckInput,
  ): Promise<import("./authz").AuthzDecision>;

  abstract checkDetailed(
    args: AuthzCheckInput,
  ): Promise<AuthzCheckDetailedOutput>;

  abstract can(args: AuthzCheckInput): Promise<boolean>;

  /** The only public operation that returns an authorization witness. */
  abstract authorize<
    Tier extends BindingScopeTier,
    Permission extends AuthzPermission,
  >(args: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
  }): Promise<Authorized<Tier, Permission>>;

  abstract effectivePermissions(
    args: AuthzEffectivePermissionsInput,
  ): Promise<AuthzEffectivePermissionsOutput>;

  abstract checkByIds(
    args: AuthzCheckByIdsInput,
  ): Promise<AuthzCheckByIdsOutput>;

  abstract canAnyByIds(
    args: AuthzCanAnyByIdsInput,
  ): Promise<AuthzCanAnyByIdsOutput>;

  abstract canBatchByIds(
    args: AuthzCanBatchByIdsInput,
  ): Promise<AuthzCanBatchByIdsOutput>;

  abstract resolveScope(
    args: AuthzResolveScopeInput,
  ): Promise<AuthzScopeRef | null>;

  abstract explainDecision(
    args: AuthzExplainDecisionInput,
  ): Promise<AuthzExplainDecisionOutput>;

  // Composed compatibility capability replacing the app PermissionsService.
  abstract getDecision(
    args: AuthzGetDecisionInput,
  ): Promise<PermissionDecision>;

  abstract getProjectAnyDecision(
    args: AuthzGetProjectAnyDecisionInput,
  ): Promise<PermissionDecision>;

  abstract hasPermission<Permission extends AuthzPermission>(
    check: {
      userId: string;
      permission: Permission;
    } & PermissionScopeArg<Permission>,
  ): Promise<boolean>;

  abstract requirePermission<
    Permission extends AuthzPermission,
    ScopeArg extends PermissionScopeArg<Permission>,
  >(
    check: { userId: string; permission: Permission } & ScopeArg,
  ): Promise<Authorized<TierOfScopeArg<ScopeArg>, Permission>>;

  abstract requireProjectPermission(
    args: AuthzRequireProjectPermissionInput,
  ): Promise<void>;

  abstract hasApiKeyPermission(args: ApiKeyPermissionCheck): Promise<boolean>;

  abstract getApiKeyProjectDecision(
    args: AuthzGetApiKeyProjectDecisionInput,
  ): Promise<ApiKeyProjectDecision>;

  // Access listing is part of this capability, not a public repository.
  abstract listUserBindings(
    args: AuthzListUserBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listOrganizationBindings(
    args: AuthzListOrganizationBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listUserAndGroupBindings(
    args: AuthzListUserAndGroupBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listScopeBindings(
    args: AuthzListScopeBindingsInput,
  ): Promise<AuthzAccessBindingsOutput>;

  abstract listGroupBindings(
    args: AuthzListGroupBindingsInput,
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

  /** Temporary rollout boundary for legacy callers that still own their
   * pre-engine fallback. Persistence and migration state remain private. */
  abstract isOnEngine(
    args: AuthzListOrganizationBindingsInput,
  ): Promise<boolean>;
}

/** Useful structural union for adapters that accept either typed path form. */
export type AuthzPermissionCapabilityInput =
  | AuthzPermissionByIdsInput
  | AuthzGetDecisionInput;
