/**
 * ADR-092 §11 — the checking API, a service over the collector. The app
 * ADR-092 §9 — api-key principals never answer from their own bindings
 * ADR-092 §6 step RECORD — denials emit one structured log line here. That
 */
import {
  AccessNotGrantedError,
  PermissionDeniedError,
  type Actor,
  type Authorization,
  type AuthorizationPurpose,
  type AuthzDeclaredScopeId,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzPermission,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  type DeclaredScopeTier,
  type PermissionDecision,
  type PermissionScopeArg,
  type TierOfScopeArg,
  isAggregateProjectKind,
} from "@langwatch/authorization";
import {
  AuthzEngine,
  type ApiKeyPermissionCheck,
  type ApiKeyProjectDecision,
  type AuthzAccessBinding,
  type AuthzActiveOrganizationAdministrators,
  type AuthzFindActiveOrganizationAdministratorsInput,
  type AuthzBindingForSynthesis,
  type AuthzCustomRole,
  type AuthzFindRolePermissionsInput,
  type AuthzRolePermissions,
  type AuthzAccessBreakdownInput,
  type AuthzAccessBreakdownOutput,
  type AuthzCanAnyByIdsInput,
  type AuthzCanAnyByIdsOutput,
  type AuthzCanBatchByIdsInput,
  type AuthzCanBatchByIdsOutput,
  type AuthzCanBatchPermissionsByIdsInput,
  type AuthzCanBatchPermissionsByIdsOutput,
  type AuthzCanInput,
  type AuthzCheckByIdsInput,
  type AuthzCheckByIdsOutput,
  type AuthzDecision,
  type AuthzGetApiKeyProjectDecisionInput,
  type AuthzListBindingsForSynthesisInput,
  type AuthzListApiKeyBindingsInput,
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
  type AuthzPrincipalRef,
  type AuthzLegacyAccessNoticeInput,
  type AuthzRequireProjectPermissionInput,
  type AuthzScopeRef,
  type AuthzTeamMemberBinding,
  type Authorized,
  type CollectedGrants,
  scopeOrganizationId,
  AuthzScopeNotFoundError,
  type AuthzFindPermissionsBeyondCallerInput,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type { AuthzLineageEpochRepository } from "../repositories/authz-lineage-epoch.repository.ts";
import type { AuthzListingRepository } from "../repositories/authz-listing.repository.ts";
import type { AuthzManagedGrantRepository } from "../repositories/authz-managed-grant.repository.ts";
import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";
import { findPermissionsBeyondHeld } from "../rules/grant-escalation.rules.ts";
import { AuthorizationService } from "./authorization.service.ts";
import type { AuthzAggregateReadAuditService } from "./authz-aggregate-read-audit.service.ts";
import { AuthzCollectorService } from "./authz-collector.service.ts";
import { AuthzDecisionService } from "./authz-decision.service.ts";
import { AuthzGrantReaderService } from "./authz-grant-reader.service.ts";
import { AuthzGrantSnapshotService } from "./authz-grant-snapshot.service.ts";
import { AuthzIdDecisionsService } from "./authz-id-decisions.service.ts";
import { AuthzPermissionGateService } from "./authz-permission-gate.service.ts";
import type { AuthzPlatformOperatorsService } from "./authz-platform-operators.service.ts";
import { AuthzScopeLineageService } from "./authz-scope-lineage.service.ts";

/** The loose ids a caller holds before a scope ref has been resolved. */
type ScopeIds = {
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

type CheckArgs = {
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
};

export type AuthzServiceOptions = {
  repository: AuthzReadRepository;
  listing: AuthzListingRepository;
  bindings: AuthzManagedGrantRepository;
  /** Omitted = never cache. */
  epoch?: AuthzEpochRepository;
  /** The organization's lineage signal; omitted = no scope lineage is held. */
  lineageEpochs?: AuthzLineageEpochRepository;
  /**
   * Internal rollout knob; omitted = cache off. The composition root supplies the env read.
   */
  cacheEnabled?: () => boolean;
  /**
   * Mirrors isDemoProject()'s dynamic env read; omitted = demo off. The composition root supplies
   * the env read.
   */
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
  findEngineCutoverAt?: (organizationId: string) => Promise<Instant | null>;
  /** Answers `can` at the platform; omitted = every platform question is refused. */
  platformOperators?: Pick<AuthzPlatformOperatorsService, "can">;
  /** Records a user's read of an aggregate (ADR-177 decision 9); omitted = not audited. */
  aggregateReads?: Pick<AuthzAggregateReadAuditService, "record">;
};

const rolePermissionListSchema = z.array(z.string());

const aggregateReadAudit = createLogger("langwatch:authz:aggregate-read-audit");

export class AuthzService {
  static create(options: AuthzServiceOptions): AuthzService {
    const scopeLineage = AuthzScopeLineageService.create({
      repository: options.repository,
      cacheEnabled: options.cacheEnabled,
      signal: options.lineageEpochs,
    });
    const collector = AuthzCollectorService.create({
      reader: options.repository,
      lineage: scopeLineage,
    });

    return new AuthzService({
      collector,
      bindingReader: AuthzGrantReaderService.create({
        bindings: options.bindings,
        listing: options.listing,
      }),
      snapshots: AuthzGrantSnapshotService.create(collector, options),
      scopeLineage,
      options,
    });
  }

  private readonly engine = new AuthzEngine();

  private readonly idDecisions: AuthzIdDecisionsService;

  private readonly decisionCore: AuthzDecisionService;

  private readonly gate: AuthzPermissionGateService;

  private readonly collector: AuthzCollectorService;
  private readonly bindingReader: AuthzGrantReaderService;
  private readonly scopeLineage: AuthzScopeLineageService;
  private readonly options: AuthzServiceOptions;
  private readonly proofs: AuthorizationService;

  private constructor({
    collector,
    bindingReader,
    snapshots,
    scopeLineage,
    options,
  }: {
    collector: AuthzCollectorService;
    bindingReader: AuthzGrantReaderService;
    snapshots: AuthzGrantSnapshotService;
    scopeLineage: AuthzScopeLineageService;
    options: AuthzServiceOptions;
  }) {
    this.collector = collector;
    this.bindingReader = bindingReader;
    this.scopeLineage = scopeLineage;
    this.options = options;
    const { epoch } = options;
    this.proofs = AuthorizationService.create({
      authz: this,
      collector,
      sharedReads: options.repository,
      ...(epoch ? { epochReader: (input) => epoch.findEpoch(input) } : {}),
      ...(options.cacheEnabled ? { cacheEnabled: options.cacheEnabled } : {}),
    });
    this.decisionCore = AuthzDecisionService.create({ engine: this.engine, snapshots });
    this.idDecisions = AuthzIdDecisionsService.create({
      engine: this.engine,
      collector,
      snapshots,
      getScope: (ids) => this.getScope(ids),
      recordDenial: (decision) => this.decisionCore.recordDenial(decision),
    });
    this.gate = AuthzPermissionGateService.create({
      authorize: (input) => this.authorize(input),
      can: (input) => this.can(input),
      canAnyByIds: (args) => this.canAnyByIds(args),
      checkByIds: (args) => this.checkByIds(args),
      getScope: (ids) => this.getScope(ids),
      tryScopeOf: (scope) => this.tryScopeOf(scope),
    });
  }

  async check(args: CheckArgs): Promise<AuthzDecision> {
    const { decision } = await this.checkDetailed(args);

    return decision;
  }

  /** check() plus the collected snapshot; see AuthzDecisionService. */
  checkDetailed(args: CheckArgs): Promise<{ decision: AuthzDecision; grants: CollectedGrants }> {
    return this.decisionCore.checkDetailed(args);
  }

  async can(args: AuthzCanInput): Promise<boolean> {
    const { scope } = args;
    if (scope.type === "platform") {
      return (await this.options.platformOperators?.can(args)) ?? false;
    }
    const decision = await this.check({ ...args, scope });

    return decision.allowed;
  }

  async isOnEngine({ organizationId }: { organizationId: string }): Promise<boolean> {
    return this.options.isOnEngine(organizationId);
  }

  async findEngineCutoverAt({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Instant | null> {
    return this.options.findEngineCutoverAt?.(organizationId) ?? null;
  }

  /** Organization's "administrator who can sign in": role ADMIN and a seat not disabled. */
  async findActiveOrganizationAdministrators({
    organizationId,
  }: AuthzFindActiveOrganizationAdministratorsInput): Promise<AuthzActiveOrganizationAdministrators> {
    return this.options.repository.findActiveAdministratorIds({ organizationId });
  }

  async authorize<Tier extends DeclaredScopeTier, Permission extends AuthzPermission>({
    principal,
    permission,
    scope,
    proof,
  }: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
    proof?: Readonly<{ actor: Actor; purpose: AuthorizationPurpose }>;
  }): Promise<Authorized<Tier, Permission> & Readonly<{ authorization: Authorization | null }>> {
    const resolved: AuthzScopeRef = scope;
    if (proof && resolved.type === "project") {
      // One engine pass decides and mints; the door does not evaluate the grants twice.
      const authorization = await this.proofs
        .authorize({
          actor: proof.actor,
          principal,
          permission,
          scope: { projectId: resolved.id },
          purpose: proof.purpose,
        })
        .catch((error: unknown) => {
          if (!(error instanceof AccessNotGrantedError)) throw error;
          throw new PermissionDeniedError({ permission, scope, denialReason: "no-binding" });
        });
      const witness = this.mintAuthorizationWitness({
        tier: "project",
        id: resolved.id,
        permission,
      });
      await this.auditAggregateRead({ actor: proof.actor, authorization, projectId: resolved.id });

      return { ...(witness as Authorized<Tier, Permission>), authorization };
    }

    const decision = await this.check({ principal, permission, scope });
    if (!decision.allowed) {
      throw new PermissionDeniedError({
        permission,
        scope,
        denialReason: decision.denialReason ?? "no-binding",
      });
    }

    const authorizedScope = scope as { type: Tier; id: string };

    return {
      ...this.mintAuthorizationWitness({
        tier: authorizedScope.type,
        id: authorizedScope.id,
        permission,
      }),
      authorization: null,
    };
  }

  /**
   * A user's read that crosses shared grants into an aggregate is audited. The audit never fails
   * the read: a failure is logged and the read carries on.
   */
  private async auditAggregateRead({
    actor,
    authorization,
    projectId,
  }: {
    actor: Actor;
    authorization: Authorization;
    projectId: string;
  }): Promise<void> {
    const audit = this.options.aggregateReads;
    if (!audit || actor.type !== "user") return;
    if (!authorization.grants.some((grant) => grant.kind === "shared")) return;
    try {
      const scope = await this.collector.findScopeRef({ projectId });
      if (scope?.type !== "project" || !isAggregateProjectKind(scope.kind)) return;
      await audit.record({
        actorUserId: actor.id,
        organizationId: authorization.scope.organizationId,
        aggregateProjectId: projectId,
      });
    } catch (error) {
      aggregateReadAudit.warn(
        { error, projectId },
        "aggregate read audit failed; the read carries on",
      );
    }
  }

  /** The only minter of a witness; the contract publishes the type and no factory. */
  /** The own-only proof for platform code reading its own project; nothing is evaluated. */
  authorizeInternal: AuthorizationService["authorizeInternal"] = (args) =>
    this.proofs.authorizeInternal(args);

  private mintAuthorizationWitness<
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
    return { permission, scope: { tier, id } } as Authorized<Tier, Permission>;
  }

  /** The caller's full effective permission set at a scope; see AuthzDecisionService. */
  effectivePermissions(args: {
    principal: AuthzPrincipalRef;
    scope: AuthzScopeRef;
  }): Promise<AuthzPermission[]> {
    return this.decisionCore.effectivePermissions(args);
  }

  /**
   * What of these permissions the caller does not hold at the scope (inherited from above
   * included). A scope outside the organization holds nothing, so all of them come back.
   */
  async findPermissionsBeyondCaller({
    organizationId,
    caller,
    scope,
    permissions,
  }: AuthzFindPermissionsBeyondCallerInput): Promise<string[]> {
    if (permissions.length === 0) return [];
    const ref = await this.getScope({
      ...(scope.type === "project" ? { projectId: scope.id } : {}),
      ...(scope.type === "team" ? { teamId: scope.id } : {}),
      ...(scope.type === "organization" ? { organizationId: scope.id } : {}),
    });
    if (scopeOrganizationId(ref) !== organizationId) return [...new Set(permissions)];
    const held = await this.effectivePermissions({ principal: caller, scope: ref });

    return findPermissionsBeyondHeld({ requested: permissions, held });
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

  /**
   * Most-specific-first, the order every seam resolves in: an explicit project or team wins over
   * the organization it sits in.
   */
  async getScope({ projectId, teamId, organizationId }: ScopeIds): Promise<AuthzScopeRef> {
    let scope: AuthzScopeRef | null = null;
    if (projectId) scope = await this.collector.findScopeRef({ projectId });
    else if (teamId) scope = await this.collector.findScopeRef({ teamId });
    else if (organizationId) scope = await this.collector.findScopeRef({ organizationId });
    if (!scope) throw new AuthzScopeNotFoundError({ projectId, teamId, organizationId });
    return scope;
  }

  async checkScopeLineage(args: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> {
    return this.scopeLineage.check(args);
  }

  /** Project's moved or archived fact for this organization; throws so the delivery retries. */
  lineageChanged(input: { organizationId: string }): Promise<void> {
    return this.scopeLineage.lineageChanged(input);
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

  async listApiKeyBindings(args: AuthzListApiKeyBindingsInput): Promise<AuthzAccessBinding[]> {
    return this.options.listing.findApiKeyBindings(args);
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

  /** A malformed stored permission set grants nothing: one bad row must not fail a read. */
  async findRolePermissions(args: AuthzFindRolePermissionsInput): Promise<AuthzRolePermissions[]> {
    const rows = await this.options.listing.findRolePermissionRows(args);
    return rows.map(({ id, name, permissions }) => {
      const parsed = rolePermissionListSchema.safeParse(permissions);
      return { id, name, permissions: parsed.success ? parsed.data : [] };
    });
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

  /** ADR-092 §6: the walk for a decision, against the current snapshot. */
  explainDecision(args: { decision: AuthzDecision }): Promise<string[]> {
    return this.decisionCore.explainDecision(args);
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
