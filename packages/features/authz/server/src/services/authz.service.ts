/**
 * ADR-092 §11 — the checking API, a service over the collector. The app
 * ADR-092 §9 — api-key principals never answer from their own bindings
 * ADR-092 §6 step RECORD — denials emit one structured log line here. That
 */
import {
  ALL_PERMISSIONS,
  AuthzEngine,
  AuthzService as AuthzServiceContract,
  PermissionDeniedError,
  type ApiKeyPermissionCheck,
  type ApiKeyProjectDecision,
  type AuthzAccessBinding,
  type AuthzBindingForSynthesis,
  type AuthzCustomRole,
  type AuthzAccessBreakdownInput,
  type AuthzAccessBreakdownOutput,
  type AuthzDeclaredScopeId,
  type AuthzCanAnyByIdsInput,
  type AuthzCanAnyByIdsOutput,
  type AuthzCanBatchByIdsInput,
  type AuthzCanBatchByIdsOutput,
  type AuthzCanBatchPermissionsByIdsInput,
  type AuthzCanBatchPermissionsByIdsOutput,
  type AuthzCheckByIdsInput,
  type AuthzCheckByIdsOutput,
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
import type { AuthzEpochPort } from "../ports/authz-epoch.port.ts";
import type { AuthzBindingRepository } from "../repositories/authz-binding.repository.ts";
import type { AuthzListingRepository } from "../repositories/authz-listing.repository.ts";
import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";
import { AuthzBindingReaderService } from "./authz-binding-reader.service.ts";
import { AuthzCollectorService } from "./authz-collector.service.ts";
import { AuthzGrantSnapshotService } from "./authz-grant-snapshot.service.ts";
import { AuthzScopeLineageService } from "./authz-scope-lineage.service.ts";
import { AuthzIdDecisionsService } from "./authz-id-decisions.service.ts";
import { AuthzPermissionGateService } from "./authz-permission-gate.service.ts";
import type { Instant } from "@langwatch/time";

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
   * call sites branch on the answer, so it is required.
   */
  isOnEngine: (organizationId: string) => Promise<boolean>;
  /** Finalized cutover time used by compatibility fact minting. */
  tryGetEngineCutoverAt?: (organizationId: string) => Promise<Instant | null>;
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

  private readonly idDecisions: AuthzIdDecisionsService;

  private readonly gate: AuthzPermissionGateService;

  private constructor(
    private readonly collector: AuthzCollectorService,
    private readonly bindingReader: AuthzBindingReaderService,
    private readonly snapshots: AuthzGrantSnapshotService,
    private readonly scopeLineage: AuthzScopeLineageService,
    private readonly options: AuthzServiceOptions,
  ) {
    super();
    this.idDecisions = AuthzIdDecisionsService.create({
      engine: this.engine,
      collector,
      snapshots,
      tryResolveScope: (ids) => this.tryResolveScope(ids),
      recordDenial: (decision) => this.recordDenial(decision),
    });
    this.gate = AuthzPermissionGateService.create({
      authorize: (input) => this.authorize(input),
      can: (input) => this.can(input),
      canAnyByIds: (args) => this.canAnyByIds(args),
      checkByIds: (args) => this.checkByIds(args),
      tryResolveScope: (ids) => this.tryResolveScope(ids),
      tryScopeOf: (scope) => this.tryScopeOf(scope),
    });
  }

  async check(args: CheckArgs): Promise<AuthzDecision> {
    const { decision } = await this.checkDetailed(args);

    return decision;
  }

  /**
   * check() plus the collected snapshot - for adapters that must also surface legacy context
   * fields (the tRPC middleware sets ctx.organizationRole from it). For an api-key principal
   * the snapshot returned is the KEY's, not the owner's: the owner only ever caps.
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
  }): Promise<Instant | null> {
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
   * The caller's full effective permission set at a scope — the frontend's single source of
   * truth (useCan). Computed by testing the whole registry against one collected snapshot:
   * pure decides over ~126 permissions.
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
   * The same question as `check`, asked with the ids a caller already holds instead of a
   * resolved scope ref.
   */
  checkByIds(args: AuthzCheckByIdsInput): Promise<AuthzCheckByIdsOutput> {
    return this.idDecisions.checkByIds(args);
  }

  /**
   * "Any one of these is enough", in the order given, first allow wins. One
   * scope resolution and one collection serve every candidate.
   */
  canAnyByIds(args: AuthzCanAnyByIdsInput): Promise<AuthzCanAnyByIdsOutput> {
    return this.idDecisions.canAnyByIds(args);
  }

  /** One permission across many scopes in one organization: one collection, N pure decisions. */
  canBatchByIds(args: AuthzCanBatchByIdsInput): Promise<AuthzCanBatchByIdsOutput> {
    return this.idDecisions.canBatchByIds(args);
  }

  /** MANY permissions across many scopes in one organization — and still ONE collection. */
  canBatchPermissionsByIds(
    args: AuthzCanBatchPermissionsByIdsInput,
  ): Promise<AuthzCanBatchPermissionsByIdsOutput> {
    return this.idDecisions.canBatchPermissionsByIds(args);
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

  getDecision(args: AuthzGetDecisionInput): Promise<PermissionDecision> {
    return this.gate.getDecision(args);
  }

  getProjectAnyDecision(args: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision> {
    return this.gate.getProjectAnyDecision(args);
  }

  hasPermission<Permission extends AuthzPermission>(
    check: { userId: string; permission: Permission } & PermissionScopeArg<Permission>,
  ): Promise<boolean> {
    return this.gate.hasPermission(check);
  }

  authorizePermission<
    Permission extends AuthzPermission,
    ScopeArg extends PermissionScopeArg<Permission>,
  >(
    check: { userId: string; permission: Permission } & ScopeArg,
  ): Promise<Authorized<TierOfScopeArg<ScopeArg>, Permission>> {
    return this.gate.authorizePermission(check);
  }

  authorizeProjectPermission(args: AuthzRequireProjectPermissionInput): Promise<void> {
    return this.gate.authorizeProjectPermission(args);
  }

  hasApiKeyPermission(args: ApiKeyPermissionCheck): Promise<boolean> {
    return this.gate.hasApiKeyPermission(args);
  }

  getApiKeyProjectDecision(
    args: AuthzGetApiKeyProjectDecisionInput,
  ): Promise<ApiKeyProjectDecision> {
    return this.gate.getApiKeyProjectDecision(args);
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
   * snapshot, not the one the decision was made against: a grant write between the decision
   * and this call changes the rendered walk.
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
   * DENY, carrying the five facts a mismatch investigation starts from.
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
