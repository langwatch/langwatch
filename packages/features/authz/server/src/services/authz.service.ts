/**
 * ADR-092 §11 — the checking API, a service over the collector. The app
 * builds ONE instance in its composition root
 * (the application AuthZ composition root) and everything asks it:
 *
 *   authz.can({ principal, permission: "prompts:update", scope })
 *   authz.check({ ... })                → full AuthzDecision, never throws
 *   authz.effectivePermissions({ ... }) → string[] (feeds useCan)
 *
 * ADR-092 §9 — api-key principals never answer from their own bindings
 * alone: effective(key) = grants(key) ∩ grants(owner), so demoting the
 * owner shrinks every key they own on the next check. A key with no owner
 * (a service key) has no ceiling, which is the legacy behaviour.
 *
 * ADR-092 §6 step RECORD — denials emit one structured log line here. That
 * is the whole of RECORD today: nothing is PERSISTED, and the decision
 * store the A4 mismatch dashboard reads lands with it. Allows are not
 * logged at all yet, for the same reason.
 *
 */
import {
  ALL_PERMISSIONS,
  AuthzEngine,
  AuthzService as AuthzServiceContract,
  LiteMemberRestrictedError,
  PermissionDeniedError,
  ProjectPermissionDeniedError,
  type ApiKeyPermissionCheck,
  type ApiKeyProjectDecision,
  type AuthzAccessBinding,
  type AuthzBindingForSynthesis,
  type AuthzCustomRole,
  type AuthzAccessBreakdownInput,
  type AuthzAccessBreakdownOutput,
  type AuthzDeclaredScopeId,
  type AuthzDecision,
  type AuthzGetApiKeyProjectDecisionInput,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzListBindingsForSynthesisInput,
  type AuthzListGroupBindingsInput,
  type AuthzListManagedBindingsForOrganizationInput,
  type AuthzListManagedBindingsForOrganizationOutput,
  type AuthzListManagedBindingsForUserInput,
  type AuthzListManagedBindingsForUserOutput,
  type AuthzListOrganizationBindingsInput,
  type AuthzListScopeBindingsInput,
  type AuthzListTeamMemberBindingsInput,
  type AuthzListUserAndGroupBindingsInput,
  type AuthzListUserBindingsInput,
  type AuthzPermission,
  type AuthzPrincipalRef,
  type AuthzLegacyAccessNoticeInput,
  type AuthzRequireProjectPermissionInput,
  type AuthzScopeRef,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  type AuthzTeamMemberBinding,
  type Authorized,
  type BindingScopeTier,
  type CollectedGrants,
  type PermissionDecision,
  type PermissionScopeArg,
  type TierOfScopeArg,
  scopeOrganizationId,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { AuthzEpochPort } from "../ports/authz-epoch.port";
import type { AuthzBindingRepository } from "../repositories/authz-binding.repository";
import type { AuthzListingRepository } from "../repositories/authz-listing.repository";
import type { AuthzReadRepository } from "../repositories/authz-read.repository";
import { AuthzBindingReaderService } from "./authz-binding-reader.service";
import { AuthzCollectorService } from "./authz-collector.service";
import { AuthzGrantSnapshotService } from "./authz-grant-snapshot.service";
import { AuthzScopeLineageService } from "./authz-scope-lineage.service";

const decisions = createLogger("langwatch:authz:decisions");

/** The loose ids a caller holds before a scope ref has been resolved. */
type ScopeIds = {
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

type OrganizationRoleOrNull = CollectedGrants["organizationRole"];

type CheckArgs = {
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
};

export type AuthzServiceOptions = {
  repository: AuthzReadRepository;
  listing: AuthzListingRepository;
  bindings: AuthzBindingRepository;
  /** Omitted = never cache. */
  epoch?: AuthzEpochPort;
  /** Internal rollout knob; omitted = cache off. The composition root
   *  supplies the env read. */
  cacheEnabled?: () => boolean;
  /** Mirrors isDemoProject()'s dynamic env read; omitted = demo off. The
   *  composition root supplies the env read. */
  demoProjectId?: () => string | undefined;
  /** Absolute cache-entry age bound; defaults to 30s. */
  cacheMaxAgeMs?: number;
  /** Rollout head used only by legacy app fallbacks during migration. */
  /**
   * Whether an organization has cut over to the authz engine. Seven production
   * call sites branch on the answer, so it is required: an absent gate used to
   * default to `true`, which is the service claiming a migration state it has
   * no evidence for. The only production composition
   * (`postgres.authz.adapter.ts`) has always supplied it.
   */
  isOnEngine: (organizationId: string) => Promise<boolean>;
  /** Finalized cutover time used by compatibility fact minting. */
  tryGetEngineCutoverAt?: (organizationId: string) => Promise<Date | null>;
};

export class AuthzService extends AuthzServiceContract {
  static create(options: AuthzServiceOptions): AuthzService {
    const collector = AuthzCollectorService.create({ reader: options.repository });

    return new AuthzService(
      collector,
      AuthzBindingReaderService.create({
        bindings: options.bindings,
        listing: options.listing,
      }),
      AuthzGrantSnapshotService.create(collector, options),
      AuthzScopeLineageService.create({ repository: options.repository }),
      options,
    );
  }

  private readonly engine = new AuthzEngine();

  private constructor(
    private readonly collector: AuthzCollectorService,
    private readonly bindingReader: AuthzBindingReaderService,
    private readonly snapshots: AuthzGrantSnapshotService,
    private readonly scopeLineage: AuthzScopeLineageService,
    private readonly options: AuthzServiceOptions,
  ) {
    super();
  }

  async check(args: CheckArgs): Promise<AuthzDecision> {
    const { decision } = await this.checkDetailed(args);

    return decision;
  }

  /**
   * check() plus the collected snapshot - for adapters that must also
   * surface legacy context fields (the tRPC middleware sets
   * ctx.organizationRole from it). For an api-key principal the snapshot
   * returned is the KEY's, not the owner's: the owner only ever caps.
   */
  async checkDetailed({ principal, permission, scope }: CheckArgs): Promise<{
    decision: AuthzDecision;
    grants: CollectedGrants;
  }> {
    const organizationId = scopeOrganizationId(scope);
    const [grants, resourceGrants, ownerGrants] = await Promise.all([
      this.snapshots.collectCached({ principal, organizationId }),
      this.snapshots.tryResourceGrantsFor(scope),
      this.snapshots.tryOwnerGrantsFor({ principal, organizationId }),
    ]);
    const decision = this.engine.decideWithCeiling({
      keyGrants: grants,
      ownerGrants,
      permission,
      scope,
      demoProjectId: this.snapshots.tryDemoProjectId(),
      resourceGrants,
    });
    this.recordDenial(decision);

    return { decision, grants };
  }

  async can(args: CheckArgs): Promise<boolean> {
    const decision = await this.check(args);

    return decision.allowed;
  }

  async isOnEngine({ organizationId }: { organizationId: string }): Promise<boolean> {
    return await this.options.isOnEngine(organizationId);
  }

  async tryGetEngineCutoverAt({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Date | null> {
    return this.options.tryGetEngineCutoverAt?.(organizationId) ?? null;
  }

  async authorize<Tier extends BindingScopeTier, Permission extends AuthzPermission>({
    principal,
    permission,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
  }): Promise<Authorized<Tier, Permission>> {
    const decision = await this.check({ principal, permission, scope });
    if (!decision.allowed) {
      throw new PermissionDeniedError({
        permission,
        scope,
        denialReason: decision.denialReason ?? "no-binding",
      });
    }

    const authorizedScope = scope as { type: Tier; id: string };

    return this.mintAuthorizationWitness({
      tier: authorizedScope.type,
      id: authorizedScope.id,
      permission,
    });
  }

  /**
   * The caller's full effective permission set at a scope — the frontend's
   * single source of truth (useCan). Computed by testing the whole registry
   * against one collected snapshot: pure decides over ~126 permissions.
   * The §9 owner ceiling applies here exactly as it does to a single
   * check, so a key's advertised set can never exceed its owner's.
   */
  async effectivePermissions({
    principal,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    scope: AuthzScopeRef;
  }): Promise<AuthzPermission[]> {
    const organizationId = scopeOrganizationId(scope);
    const [grants, resourceGrants, ownerGrants] = await Promise.all([
      this.snapshots.collectCached({ principal, organizationId }),
      this.snapshots.tryResourceGrantsFor(scope),
      this.snapshots.tryOwnerGrantsFor({ principal, organizationId }),
    ]);
    const demo = this.snapshots.tryDemoProjectId();

    return ALL_PERMISSIONS.filter(
      (permission) =>
        this.engine.decideWithCeiling({
          keyGrants: grants,
          ownerGrants,
          permission,
          scope,
          demoProjectId: demo,
          resourceGrants,
        }).allowed,
    );
  }

  /**
   * The same question as `check`, asked with the ids a caller already holds
   * instead of a resolved scope ref. Most call sites have a projectId or a
   * teamId and nothing else, and resolving the ref themselves is the step
   * they used to get wrong; the collector resolves it here, most specific
   * first.
   *
   * `ceiling: false` reports the named principal's own grants and nothing
   * else — the contract of the seams that answer "what does THIS binding
   * give you", which must not be capped by an api key's owner.
   */
  async checkByIds({
    principal,
    permission,
    projectId,
    teamId,
    organizationId,
    ceiling = true,
  }: ScopeIds & {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    ceiling?: boolean;
  }): Promise<{
    allowed: boolean;
    organizationRole: OrganizationRoleOrNull;
    denialReason?: AuthzDecision["denialReason"];
  }> {
    const scope = await this.tryResolveScope({
      projectId,
      teamId,
      organizationId,
    });
    if (!scope) {
      return { allowed: false, organizationRole: null };
    }

    const scopeOrg = scopeOrganizationId(scope);
    const pass = this.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.collector.collectGrants({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
      ceiling
        ? this.snapshots.tryOwnerGrantsFor({
            principal,
            organizationId: scopeOrg,
            reader: pass,
          })
        : Promise.resolve(null),
    ]);
    const decision = this.engine.decideWithCeiling({
      keyGrants: grants,
      ownerGrants,
      permission,
      scope,
      demoProjectId: this.snapshots.tryDemoProjectId(),
    });
    this.recordDenial(decision);

    return {
      allowed: decision.allowed,
      organizationRole: grants.organizationRole,
      ...(decision.denialReason ? { denialReason: decision.denialReason } : {}),
    };
  }

  /**
   * "Any one of these is enough", in the order given, first allow wins. One
   * scope resolution and one collection serve every candidate — asking per
   * permission would re-query for an answer the first snapshot already holds.
   */
  async canAnyByIds({
    principal,
    permissions,
    projectId,
  }: {
    principal: AuthzPrincipalRef;
    permissions: readonly AuthzPermission[];
    projectId: string;
  }): Promise<{
    allowed: boolean;
    matchedPermission?: AuthzPermission;
    organizationRole: OrganizationRoleOrNull;
    denialReason?: AuthzDecision["denialReason"];
  }> {
    const scope = await this.collector.tryResolveScopeRef({ projectId });
    if (!scope) {
      return { allowed: false, organizationRole: null };
    }

    // Same api-key owner ceiling every other decision path applies: an
    // api-key principal is capped at its owner's grants, so demoting the owner
    // shrinks the key here too. `ownerGrantsFor` returns null for a user
    // principal, and `decideWithCeiling` with a null ceiling is a plain
    // decide — so this is a no-op for the user callers this has today and
    // closes the hole before an api-key caller reaches it.
    const scopeOrg = scopeOrganizationId(scope);
    const pass = this.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.collector.collectGrants({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
      this.snapshots.tryOwnerGrantsFor({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
    ]);
    const demoProjectId = this.snapshots.tryDemoProjectId();
    let matched: AuthzPermission | undefined;
    let firstDenied: AuthzDecision | undefined;
    for (const permission of permissions) {
      const decision = this.engine.decideWithCeiling({
        keyGrants: grants,
        ownerGrants,
        permission,
        scope,
        demoProjectId,
      });
      if (decision.allowed) {
        matched = permission;
        break;
      }
      firstDenied ??= decision;
    }
    const result: {
      allowed: boolean;
      matchedPermission?: AuthzPermission;
      organizationRole: OrganizationRoleOrNull;
      denialReason?: AuthzDecision["denialReason"];
    } = {
      allowed: matched !== undefined,
      organizationRole: grants.organizationRole,
    };
    if (matched) {
      result.matchedPermission = matched;
    } else if (firstDenied?.denialReason) {
      result.denialReason = firstDenied.denialReason;
    }

    return result;
  }

  /**
   * One permission across many scopes in one organization: one collection,
   * N pure decisions. Deciding per scope would turn a flat batch into a
   * collect per scope, which is the pool-starving fan-out this replaces.
   * Only a project whose team the caller does not already know costs a
   * resolution, and those resolve in parallel.
   */
  async canBatchByIds({
    principal,
    permission,
    organizationId,
    teams,
    projects,
  }: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    organizationId: string;
    teams: ReadonlyArray<{ teamId: string }>;
    projects: ReadonlyArray<{ projectId: string; teamId?: string | undefined }>;
  }): Promise<{
    teams: Map<string, boolean>;
    projects: Map<string, boolean>;
    organizationRole: OrganizationRoleOrNull;
  }> {
    // The api-key owner ceiling, off the same snapshot as the key's grants —
    // see `canAnyByIds`. Null for a user principal, so a no-op for the callers
    // this has today.
    const pass = this.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.collector.collectGrants({
        principal,
        organizationId,
        reader: pass,
      }),
      this.snapshots.tryOwnerGrantsFor({ principal, organizationId, reader: pass }),
    ]);
    const demoProjectId = this.snapshots.tryDemoProjectId();
    const allowedAt = (scope: AuthzScopeRef | null): boolean =>
      scope
        ? this.engine.decideWithCeiling({
            keyGrants: grants,
            ownerGrants,
            permission,
            scope,
            demoProjectId,
          }).allowed
        : false;

    const resolvedProjects = await Promise.all(
      projects.map(async ({ projectId, teamId }): Promise<[string, boolean]> => [
        projectId,
        allowedAt(
          teamId
            ? { type: "project", id: projectId, teamId, organizationId }
            : await this.collector.tryResolveScopeRef({ projectId }),
        ),
      ]),
    );

    return {
      teams: new Map(
        teams.map(({ teamId }) => [
          teamId,
          allowedAt({ type: "team", id: teamId, organizationId }),
        ]),
      ),
      projects: new Map(resolvedProjects),
      organizationRole: grants.organizationRole,
    };
  }

  /** Most-specific-first, the order every seam resolves in: an explicit
   *  project or team wins over the organization it sits in. */
  async tryResolveScope({
    projectId,
    teamId,
    organizationId,
  }: ScopeIds): Promise<AuthzScopeRef | null> {
    if (projectId) {
      return this.collector.tryResolveScopeRef({ projectId });
    }

    if (teamId) {
      return this.collector.tryResolveScopeRef({ teamId });
    }

    if (organizationId) {
      return this.collector.tryResolveScopeRef({ organizationId });
    }

    return null;
  }

  async checkScopeLineage(args: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> {
    return this.scopeLineage.check(args);
  }

  async getDecision({
    userId,
    permission,
    scope,
  }: AuthzGetDecisionInput): Promise<PermissionDecision> {
    const ids: ScopeIds = {};
    if (scope.tier === "project") {
      ids.projectId = scope.id;
    }

    if (scope.tier === "team") {
      ids.teamId = scope.id;
    }

    if (scope.tier === "organization") {
      ids.organizationId = scope.id;
    }

    const result = await this.checkByIds({
      principal: { type: "user", id: userId },
      permission,
      ...ids,
    });

    return {
      permitted: result.allowed,
      organizationRole: result.organizationRole,
      ...(result.denialReason ? { denialReason: result.denialReason } : {}),
    };
  }

  async getProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision> {
    const result = await this.canAnyByIds({
      principal: { type: "user", id: userId },
      projectId,
      permissions,
    });

    return {
      permitted: result.allowed,
      organizationRole: result.organizationRole,
      ...(result.denialReason ? { denialReason: result.denialReason } : {}),
    };
  }

  async hasPermission<Permission extends AuthzPermission>(
    check: {
      userId: string;
      permission: Permission;
    } & PermissionScopeArg<Permission>,
  ): Promise<boolean> {
    const scope = this.tryScopeOf(check);
    if (!scope) {
      return false;
    }

    const decision = await this.getDecision({
      userId: check.userId,
      permission: check.permission,
      scope,
    });

    return decision.permitted;
  }

  async authorizePermission<
    Permission extends AuthzPermission,
    ScopeArg extends PermissionScopeArg<Permission>,
  >(
    check: { userId: string; permission: Permission } & ScopeArg,
  ): Promise<Authorized<TierOfScopeArg<ScopeArg>, Permission>> {
    const declaredScope = this.tryScopeOf(check);
    let scope: AuthzScopeRef | null = null;
    if (declaredScope?.tier === "project") {
      scope = await this.tryResolveScope({ projectId: declaredScope.id });
    } else if (declaredScope?.tier === "team") {
      scope = await this.tryResolveScope({ teamId: declaredScope.id });
    } else if (declaredScope?.tier === "organization") {
      scope = await this.tryResolveScope({ organizationId: declaredScope.id });
    }

    if (!scope || scope.type === "resource") {
      throw new PermissionDeniedError({
        permission: check.permission,
        scope: {
          type: declaredScope?.tier ?? "project",
          id: declaredScope?.id ?? "unresolved",
        },
        denialReason: "no-binding",
      });
    }

    const witness = await this.authorize({
      principal: { type: "user", id: check.userId },
      permission: check.permission,
      scope,
    });

    return witness as Authorized<TierOfScopeArg<ScopeArg>, Permission>;
  }

  async authorizeProjectPermission({
    userId,
    projectId,
    permission,
  }: AuthzRequireProjectPermissionInput): Promise<void> {
    const result = await this.checkByIds({
      principal: { type: "user", id: userId },
      projectId,
      permission,
    });
    if (result.allowed) {
      return;
    }

    if (result.organizationRole === "EXTERNAL") {
      throw new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown");
    }

    throw new ProjectPermissionDeniedError(permission);
  }

  async hasApiKeyPermission({
    apiKeyId,
    organizationId,
    scope,
    permission,
  }: ApiKeyPermissionCheck): Promise<boolean> {
    let resolvedScope: AuthzScopeRef;
    if (scope.type === "project") {
      resolvedScope = {
        type: "project",
        id: scope.id,
        teamId: scope.teamId,
        organizationId,
      };
    } else if (scope.type === "team") {
      resolvedScope = { type: "team", id: scope.id, organizationId };
    } else {
      resolvedScope = { type: "organization", id: scope.id };
    }

    return this.can({
      principal: { type: "apiKey", id: apiKeyId },
      permission,
      scope: resolvedScope,
    });
  }

  async getApiKeyProjectDecision({
    apiKeyId,
    organizationId,
    projectId,
    permission,
  }: AuthzGetApiKeyProjectDecisionInput): Promise<ApiKeyProjectDecision> {
    const scope = await this.tryResolveScope({ projectId });
    if (scope?.type !== "project" || scope.organizationId !== organizationId) {
      return { outcome: "project_not_found" };
    }

    const allowed = await this.can({
      principal: { type: "apiKey", id: apiKeyId },
      permission,
      scope,
    });

    return allowed
      ? {
          outcome: "allowed",
          scope: {
            projectId: scope.id,
            teamId: scope.teamId,
            organizationId: scope.organizationId,
          },
        }
      : { outcome: "denied" };
  }

  async listUserBindings(args: AuthzListUserBindingsInput): Promise<AuthzAccessBinding[]> {
    return this.options.listing.findUserBindings(args);
  }

  async listOrganizationBindings(
    args: AuthzListOrganizationBindingsInput,
  ): Promise<AuthzAccessBinding[]> {
    return this.options.listing.findOrganizationBindings(args);
  }

  async listUserAndGroupBindings(
    args: AuthzListUserAndGroupBindingsInput,
  ): Promise<AuthzAccessBinding[]> {
    return this.options.listing.findUserAndGroupBindings(args);
  }

  async listScopeBindings(args: AuthzListScopeBindingsInput): Promise<AuthzAccessBinding[]> {
    return this.options.listing.findScopeBindings(args);
  }

  async listGroupBindings(args: AuthzListGroupBindingsInput): Promise<AuthzAccessBinding[]> {
    return this.options.listing.findGroupBindings(args);
  }

  async listTeamMemberBindings(
    args: AuthzListTeamMemberBindingsInput,
  ): Promise<Map<string, AuthzTeamMemberBinding[]>> {
    return this.options.listing.findTeamMemberBindings(args);
  }

  async listBindingsForSynthesis(
    args: AuthzListBindingsForSynthesisInput,
  ): Promise<AuthzBindingForSynthesis[]> {
    return this.options.listing.findBindingsForSynthesis(args);
  }

  async listUserCreatedRoles(args: AuthzListOrganizationBindingsInput): Promise<AuthzCustomRole[]> {
    return this.options.listing.findUserCreatedRoles(args);
  }

  wouldFirstBindingDisableLegacyAccess(args: AuthzLegacyAccessNoticeInput): Promise<boolean> {
    return this.bindingReader.wouldFirstBindingDisableLegacyAccess(args);
  }

  listManagedBindingsForUser(
    args: AuthzListManagedBindingsForUserInput,
  ): Promise<AuthzListManagedBindingsForUserOutput> {
    return this.bindingReader.listForUser(args);
  }

  listManagedBindingsForOrganization(
    args: AuthzListManagedBindingsForOrganizationInput,
  ): Promise<AuthzListManagedBindingsForOrganizationOutput> {
    return this.bindingReader.listForOrganization(args);
  }

  getAccessBreakdown(args: AuthzAccessBreakdownInput): Promise<AuthzAccessBreakdownOutput> {
    return this.bindingReader.getAccessBreakdown(args);
  }

  /**
   * ADR-092 §6 — render the walk for a decision against the CURRENT grant
   * snapshot, not the one the decision was made against: a grant write
   * between the decision and this call changes the rendered walk. Carrying
   * the decision's own snapshot lands with the stage E explain surface.
   */
  async explainDecision({ decision }: { decision: AuthzDecision }): Promise<string[]> {
    const grants = await this.snapshots.collectCached({
      principal: decision.principal,
      organizationId: scopeOrganizationId(decision.scope),
    });

    return this.engine.explain({ decision, grants });
  }

  /**
   * ADR-092 §6 step RECORD, as far as it goes today: one structured line per
   * DENY, carrying the five facts a mismatch investigation starts from. Allows
   * are deliberately not logged - the volume only pays for itself once there
   * is a decision store behind it, which lands with the A4 dashboard.
   */
  private recordDenial(decision: AuthzDecision): void {
    if (decision.allowed) {
      return;
    }

    decisions.info(
      {
        principalType: decision.principal.type,
        principalId: decision.principal.type === "anonymous" ? undefined : decision.principal.id,
        permission: decision.permission,
        scopeType: decision.scope.type,
        scopeId: decision.scope.id,
        denialReason: decision.denialReason,
      },
      "authz decision denied",
    );
  }

  /** Fail closed if an untyped caller bypasses the exclusive scope argument. */
  private tryScopeOf(
    scope: Partial<Record<"projectId" | "teamId" | "organizationId", string>>,
  ): AuthzDeclaredScopeId | null {
    if (scope.projectId) {
      return { tier: "project", id: scope.projectId };
    }

    if (scope.teamId) {
      return { tier: "team", id: scope.teamId };
    }

    if (scope.organizationId) {
      return { tier: "organization", id: scope.organizationId };
    }

    return null;
  }
}
