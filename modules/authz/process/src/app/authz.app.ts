import { type AuthzPermission } from "@langwatch/authorization";
import {
  AuthzApi as AuthzApiToken,
  authzBrowserConfig,
  authzServerConfig,
  type AuthzApi,
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  type AuthzAttachResourceGrantInput,
  type AuthzCaller,
  type AuthzChangeBindingRoleInput,
  type AuthzDefineRoleInput,
  type AuthzDeleteRoleInput,
  type AuthzGrantsService,
  type AuthzOffboardMemberInput,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzRevokeBindingsWhereOutput,
  type AuthzRevokeResourceGrantsInput,
  type AuthzService,
  type EffectivePermissions,
  type AuthzServerConfig,
  AuthzScopeNotFoundError,
  type AuthzScopeRef,
  PLATFORM_OPERATOR_PERMISSIONS,
  newAuthzGrantId,
} from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/process";
import type { SystemMigration } from "@langwatch/system-migrations";

import { type AuthzGrantPipeline, EventingAuthzAdapter } from "../eventing/authz-grant.pipeline.ts";
import { EventingAuthzLedgerAdapter } from "../eventing/authz-grant.store.ts";
import {
  type AttachGrantLedgerInput,
  type AuthzEngineLedger,
  type ChangeGrantRoleLedgerInput,
  type DefineRoleLedgerInput,
  type DeleteRoleLedgerInput,
  LegacyImportAuthzGrantMigration,
  type RevokeGrantLedgerInput,
} from "../migrations/legacy-import.authz-grant.migration.ts";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import { EventingAuthzGrantRepository } from "../repositories/eventing/eventing.authz-grant.repository.ts";
import { bindingWire } from "../rules/role-binding-read-back.rules.ts";
import { AuthzAdmissionService } from "../services/authz-admission.service.ts";
import { AuthzCutoverGateService } from "../services/authz-cutover-gate.service.ts";
import { AuthzGrantIdentityService } from "../services/authz-grant-identity.service.ts";
import {
  type AuthzGrantsCommandDispatcher,
  AuthzCommandDispatcherService,
} from "../services/authz-grants-command-dispatcher.service.ts";
import { AuthzGrantsService as AuthzGrantWriteService } from "../services/authz-grants.service.ts";
import { AuthzPlatformOperatorsService } from "../services/authz-platform-operators.service.ts";
import { AuthzSessionVersionService } from "../services/authz-session-version.service.ts";
import { AuthzUserStandingService } from "../services/authz-user-standing.service.ts";
import { AuthzService as AuthzPermissionService } from "../services/authz.service.ts";

type AuthzPipeline = AuthzGrantPipeline;

/**
 * Private server-side compatibility seam for callers whose legacy operations
 * cannot yet be expressed by the smaller high-level grant verbs. It remains
 * behind AuthzGrantsService and is never exported from the package root.
 */
export interface AuthzCompatibilityLedger {
  attachBindings(
    args: Omit<AuthzAttachBindingsInput, "caller">,
  ): Promise<AuthzAttachBindingsOutput>;
  attachResourceGrant(args: AuthzAttachResourceGrantInput): Promise<void>;
  revokeResourceGrants(args: AuthzRevokeResourceGrantsInput): Promise<void>;
  changeBindingRole(args: Omit<AuthzChangeBindingRoleInput, "caller">): Promise<void>;
  revokeBindings(args: AuthzRevokeBindingsInput): Promise<void>;
  revokeBindingsWhere(args: AuthzRevokeBindingsWhereInput): Promise<AuthzRevokeBindingsWhereOutput>;
  offboardMember(args: AuthzOffboardMemberInput): Promise<void>;
  defineRole(args: AuthzDefineRoleInput): Promise<void>;
  deleteRole(args: AuthzDeleteRoleInput): Promise<void>;
}

export type AuthzSetup = FeatureSetup<Readonly<{}>, never, AuthzServerConfig, AuthzRepositories>;

/**
 * The legacy import speaks the command vocabulary directly: it supplies
 * content-derived command ids and business times, through the same
 * dispatcher as live writes, so there is one producer topology and error policy.
 */
class DispatcherAuthzEngineLedger implements AuthzEngineLedger {
  constructor(private readonly dispatcher: AuthzGrantsCommandDispatcher) {}

  private async commands() {
    return (await this.dispatcher.commands()).commands;
  }

  async attachGrant({ organizationId, commandId, grant }: AttachGrantLedgerInput): Promise<void> {
    await (
      await this.commands()
    ).attachGrant.send({ tenantId: organizationId, organizationId, commandId, grant });
  }

  async defineRole({ organizationId, commandId, role, actor }: DefineRoleLedgerInput) {
    await (
      await this.commands()
    ).defineRole.send({ tenantId: organizationId, organizationId, commandId, role, actor });
  }

  async changeGrantRole(input: ChangeGrantRoleLedgerInput): Promise<void> {
    await (
      await this.commands()
    ).changeGrantRole.send({ tenantId: input.organizationId, ...input });
  }

  async revokeGrant(input: RevokeGrantLedgerInput): Promise<void> {
    await (await this.commands()).revokeGrant.send({ tenantId: input.organizationId, ...input });
  }

  async deleteRole(input: DeleteRoleLedgerInput): Promise<void> {
    await (await this.commands()).deleteRole.send({ tenantId: input.organizationId, ...input });
  }
}

/** The composed callable authorization boundary. */
export class AuthzModule implements AuthzApi {
  static readonly contract = AuthzApiToken;
  static readonly dependencies = {} as const;
  static readonly config = authzServerConfig;
  static readonly publicConfig = authzBrowserConfig.project;
  #permissions: AuthzService;
  #grantIdentity = AuthzGrantIdentityService.create();
  #grants: AuthzGrantsService;
  /**
   * Both absent on an app built by {@link AuthzModule.fromServices}: a hand
   * composition registers the pipeline and connects the dispatcher itself, so
   * it has no use for either and this app never holds one.
   */
  #dispatcher: AuthzCommandDispatcherService | undefined;
  #pipeline: AuthzPipeline | undefined;
  #demoProjectId: string | undefined;
  #demoProjectUserId: string | undefined;
  /**
   * Absent on an app built by {@link AuthzModule.fromServices}, which composes
   * no repositories; the three admission verbs refuse by name there.
   */
  #admissions: AuthzAdmissionService | undefined;
  /** Absent on an app built by {@link AuthzModule.fromServices}, which composes no migration. */
  #migration: SystemMigration | undefined;
  /**
   * Absent on an app built by {@link AuthzModule.fromServices}, which composes no version store.
   */
  #sessionVersions: AuthzSessionVersionService | undefined;
  /**
   * Absent on an app built by {@link AuthzModule.fromServices}, which composes no platform tier.
   */
  #platformOperators: AuthzPlatformOperatorsService | undefined;

  private constructor(
    permissions: AuthzService,
    grants: AuthzGrantsService,
    options: Readonly<{
      demoProjectId?: string | undefined;
      demoProjectUserId?: string | undefined;
      admissions?: AuthzAdmissionService;
      migration?: SystemMigration;
      sessionVersions?: AuthzSessionVersionService;
      platformOperators?: AuthzPlatformOperatorsService;
      eventing?: Readonly<{
        pipeline: AuthzPipeline;
        dispatcher: AuthzCommandDispatcherService;
      }>;
    }> = {},
  ) {
    this.#permissions = permissions;
    this.#grants = grants;
    this.#pipeline = options.eventing?.pipeline;
    this.#dispatcher = options.eventing?.dispatcher;
    this.#demoProjectId = options.demoProjectId;
    this.#demoProjectUserId = options.demoProjectUserId;
    this.#admissions = options.admissions;
    this.#migration = options.migration;
    this.#sessionVersions = options.sessionVersions;
    this.#platformOperators = options.platformOperators;
  }

  /**
   * The definition this module's eventing declaration registers. Refuses
   * rather than returning nothing: the only app without one is hand-composed,
   * which would ask to register a pipeline it already registers itself.
   */
  eventingPipeline(): AuthzPipeline {
    if (!this.#pipeline) {
      throw new Error(
        "This AuthzModule was composed from already-built services, so it holds no pipeline: " +
          "the composition that built them registers its own.",
      );
    }
    return this.#pipeline;
  }

  /**
   * Build AuthZ graph; dispatcher constructed here, connected by eventing
   * (needs pipeline's registered senders). Metrics optional for non-scrape.
   */
  static create({ config: serverConfig, repositories }: AuthzSetup): AuthzModule {
    const dispatcher = AuthzCommandDispatcherService.create();
    const config = authzRuntimeConfig(serverConfig);
    const { epoch } = repositories;
    const cutover = AuthzCutoverGateService.create({ repository: repositories.cutover });
    const ledger = EventingAuthzLedgerAdapter.create({
      reads: repositories.ledgerReads,
      dispatcher,
      epoch,
      revocation: repositories.revocation,
      membershipStamps: repositories.membershipStamps,
    });
    const platformOperators = AuthzPlatformOperatorsService.create({
      grants: repositories.platformGrants,
      standings: repositories.userStandings,
      ledger,
      newGrantId: newAuthzGrantId,
    });
    const userStandings = AuthzUserStandingService.create({
      standings: repositories.userStandings,
      platformOperators,
    });
    // Migration completion still answers compatibility writes and legacy
    // API-key adoption; every decision and listing reads the grants head.
    const permissions = AuthzPermissionService.create({
      repository: repositories.read,
      listing: repositories.listing,
      bindings: repositories.bindings,
      epoch,
      isOnEngine: (organizationId) => cutover.isOn({ organizationId }),
      findEngineCutoverAt: (organizationId) => cutover.findFinalizedAt({ organizationId }),
      platformOperators,
      cacheEnabled: config.cacheEnabled,
      demoProjectId: config.demoProjectId,
    });
    const grants = AuthzGrantWriteService.create({
      repository: EventingAuthzGrantRepository.create({
        reads: repositories.ledgerReads,
        lineage: repositories.read,
        writer: ledger,
      }),
      epoch,
      newBindingId: newAuthzGrantId,
      ledger,
      bindings: repositories.bindings,
      permissions,
    });
    const sessionVersions = AuthzSessionVersionService.create({
      versions: repositories.sessionVersions,
      bindings: repositories.bindings,
    });
    const pipeline = EventingAuthzAdapter.build({
      authzGrantsWriteStore: repositories.grantProjection,
      authzAuditTrailStore: repositories.auditTrail,
      sessionVersions,
      userStandings,
    });
    const migration = LegacyImportAuthzGrantMigration.create({
      store: repositories.migration,
      ledger: new DispatcherAuthzEngineLedger(dispatcher),
      now: Date.now,
    });

    return new AuthzModule(permissions, grants, {
      demoProjectId: config.demoProjectId(),
      demoProjectUserId: serverConfig.demoProjectUserId,
      admissions: AuthzAdmissionService.create({ admissions: repositories.admissions }),
      migration,
      sessionVersions,
      platformOperators,
      eventing: { pipeline, dispatcher },
    });
  }

  /**
   * Opens the ledger's write path, once the pipeline this app built has been
   * registered and answered with its senders.
   */
  connectCommands(commands: Readonly<Record<string, unknown>>): void {
    this.#dispatcher?.connect(AuthzCommandDispatcherService.sendersFrom(commands));
  }

  /**
   * Binds the callable boundary to services already constructed by a process
   * composition root. This keeps every API client on the same authorization
   * and grants graph as the legacy transport collaborators.
   */
  static fromServices(input: {
    permissions: AuthzService;
    grants: AuthzGrantsService;
    config?: AuthzServerConfig | undefined;
  }): AuthzModule {
    return new AuthzModule(input.permissions, input.grants, {
      demoProjectId: input.config?.demoProjectId,
      demoProjectUserId: input.config?.demoProjectUserId,
    });
  }
  isDemoProject: AuthzApi["isDemoProject"] = ({ projectId }) => this.#demoProjectId === projectId;
  /** Blank rather than absent: the shape the composition this replaced answered. */
  demoProject(): Readonly<{ projectId: string; userId: string }> {
    return { projectId: this.#demoProjectId ?? "", userId: this.#demoProjectUserId ?? "" };
  }

  async effectivePermissionsFor(
    input: Readonly<{ projectId?: string; organizationId?: string }>,
    by: AuthzCaller,
  ): Promise<EffectivePermissions> {
    let scope: AuthzScopeRef;
    try {
      scope = await this.getScope({
        projectId: input.projectId,
        organizationId: input.projectId ? undefined : input.organizationId,
      });
    } catch (error) {
      if (AuthzScopeNotFoundError.is(error)) {
        return { scope: null, permissions: [...(await this.platformPermissionsOf(by))] };
      }
      throw error;
    }
    const [scoped, platform] = await Promise.all([
      this.effectivePermissions({ principal: { type: "user", id: by.id }, scope }),
      this.platformPermissionsOf(by),
    ]);
    return {
      scope: { type: scope.type, id: scope.id },
      permissions: [...scoped, ...platform],
    };
  }

  /** The session's own ops permissions: only a platform grant confers them, at any scope. */
  private async platformPermissionsOf(by: AuthzCaller): Promise<AuthzPermission[]> {
    const held = await Promise.all(
      PLATFORM_OPERATOR_PERMISSIONS.map((permission) =>
        this.#permissions.can({
          principal: { type: "user", id: by.id },
          permission,
          scope: { type: "platform" },
        }),
      ),
    );

    return PLATFORM_OPERATOR_PERMISSIONS.filter((_, index) => held[index]);
  }
  check: AuthzApi["check"] = (a) => this.#permissions.check(a);
  checkDetailed: AuthzApi["checkDetailed"] = (a) => this.#permissions.checkDetailed(a);
  can: AuthzApi["can"] = (a) => this.#permissions.can(a);
  authorize: AuthzApi["authorize"] = (a) => this.#permissions.authorize(a);
  effectivePermissions: AuthzApi["effectivePermissions"] = (a) =>
    this.#permissions.effectivePermissions(a);
  checkByIds: AuthzApi["checkByIds"] = (a) => this.#permissions.checkByIds(a);
  canAnyByIds: AuthzApi["canAnyByIds"] = (a) => this.#permissions.canAnyByIds(a);
  canBatchByIds: AuthzApi["canBatchByIds"] = (a) => this.#permissions.canBatchByIds(a);
  canBatchPermissionsByIds: AuthzApi["canBatchPermissionsByIds"] = (a) =>
    this.#permissions.canBatchPermissionsByIds(a);
  getScope: AuthzApi["getScope"] = (a) => this.#permissions.getScope(a);
  checkScopeLineage: AuthzApi["checkScopeLineage"] = (a) => this.#permissions.checkScopeLineage(a);
  explainDecision: AuthzApi["explainDecision"] = (a) => this.#permissions.explainDecision(a);
  getDecision: AuthzApi["getDecision"] = (a) => this.#permissions.getDecision(a);
  getProjectAnyDecision: AuthzApi["getProjectAnyDecision"] = (a) =>
    this.#permissions.getProjectAnyDecision(a);
  hasPermission: AuthzApi["hasPermission"] = (a) => this.#permissions.hasPermission(a);
  authorizePermission: AuthzApi["authorizePermission"] = (a) =>
    this.#permissions.authorizePermission(a);
  authorizeProjectPermission: AuthzApi["authorizeProjectPermission"] = (a) =>
    this.#permissions.authorizeProjectPermission(a);
  hasApiKeyPermission: AuthzApi["hasApiKeyPermission"] = (a) =>
    this.#permissions.hasApiKeyPermission(a);
  getApiKeyProjectDecision: AuthzApi["getApiKeyProjectDecision"] = (a) =>
    this.#permissions.getApiKeyProjectDecision(a);
  listUserBindings: AuthzApi["listUserBindings"] = (a) => this.#permissions.listUserBindings(a);
  listOrganizationBindings: AuthzApi["listOrganizationBindings"] = (a) =>
    this.#permissions.listOrganizationBindings(a);
  listUserAndGroupBindings: AuthzApi["listUserAndGroupBindings"] = (a) =>
    this.#permissions.listUserAndGroupBindings(a);
  listScopeBindings: AuthzApi["listScopeBindings"] = (a) => this.#permissions.listScopeBindings(a);
  listGroupBindings: AuthzApi["listGroupBindings"] = (a) => this.#permissions.listGroupBindings(a);
  listApiKeyBindings: AuthzApi["listApiKeyBindings"] = (a) =>
    this.#permissions.listApiKeyBindings(a);
  listTeamMemberBindings: AuthzApi["listTeamMemberBindings"] = (a) =>
    this.#permissions.listTeamMemberBindings(a);
  listBindingsForSynthesis: AuthzApi["listBindingsForSynthesis"] = (a) =>
    this.#permissions.listBindingsForSynthesis(a);
  listUserCreatedRoles: AuthzApi["listUserCreatedRoles"] = (a) =>
    this.#permissions.listUserCreatedRoles(a);
  findRolePermissions: AuthzApi["findRolePermissions"] = (a) =>
    this.#permissions.findRolePermissions(a);
  wouldFirstBindingDisableLegacyAccess: AuthzApi["wouldFirstBindingDisableLegacyAccess"] = (a) =>
    this.#permissions.wouldFirstBindingDisableLegacyAccess(a);
  listManagedBindingsForUser: AuthzApi["listManagedBindingsForUser"] = (a) =>
    this.#permissions.listManagedBindingsForUser(a);
  listManagedBindingsForOrganization: AuthzApi["listManagedBindingsForOrganization"] = (a) =>
    this.#permissions.listManagedBindingsForOrganization(a);
  getAccessBreakdown: AuthzApi["getAccessBreakdown"] = (a) =>
    this.#permissions.getAccessBreakdown(a);
  isOnEngine: AuthzApi["isOnEngine"] = (a) => this.#permissions.isOnEngine(a);
  findEngineCutoverAt: AuthzApi["findEngineCutoverAt"] = (a) =>
    this.#permissions.findEngineCutoverAt(a);
  readPendingAdmission: AuthzApi["readPendingAdmission"] = (a) =>
    this.admissions().readPendingAdmission(a);
  completeAdmission: AuthzApi["completeAdmission"] = (a) => this.admissions().completeAdmission(a);
  clearPendingAdmission: AuthzApi["clearPendingAdmission"] = (a) =>
    this.admissions().clearPendingAdmission(a);

  grantPlatformOperator: AuthzApi["grantPlatformOperator"] = (a) =>
    this.platformOperators().grant(a);
  revokePlatformOperator: AuthzApi["revokePlatformOperator"] = (a) =>
    this.platformOperators().revoke(a);
  listPlatformOperators: AuthzApi["listPlatformOperators"] = () => this.platformOperators().list();

  getSessionVersion: AuthzApi["getSessionVersion"] = (a) => {
    if (!this.#sessionVersions) {
      throw new Error(
        "This AuthzModule was composed from already-built services, so it holds no session " +
          "version store: compose it through AuthzModule.create to read one.",
      );
    }
    return this.#sessionVersions.getSessionVersion(a);
  };

  hasProjectPermission(a: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<boolean> {
    return this.#permissions.hasPermission(a);
  }
  /**
   * The one derivation, answered for every module that writes a binding it
   * does not own the ledger for. It reads nothing and awaits nothing: the id
   * is a function of the grant's own content.
   */
  deriveGrantId: AuthzApi["deriveGrantId"] = (a) => this.#grantIdentity.deriveGrantId(a);
  revoke: AuthzApi["revoke"] = (a) => this.#grants.revoke(a);
  offboard: AuthzApi["offboard"] = (a) => this.#grants.offboard(a);
  invalidateOrganization: AuthzApi["invalidateOrganization"] = (a) =>
    this.#grants.invalidateOrganization(a);
  attachBindings: AuthzApi["attachBindings"] = (a) => this.#grants.attachBindings(a);
  attachResourceGrant: AuthzApi["attachResourceGrant"] = (a) => this.#grants.attachResourceGrant(a);
  revokeResourceGrants: AuthzApi["revokeResourceGrants"] = (a) =>
    this.#grants.revokeResourceGrants(a);
  changeBindingRole: AuthzApi["changeBindingRole"] = (a) => this.#grants.changeBindingRole(a);
  revokeBindings: AuthzApi["revokeBindings"] = (a) => this.#grants.revokeBindings(a);
  revokeBindingsWhere: AuthzApi["revokeBindingsWhere"] = (a) => this.#grants.revokeBindingsWhere(a);
  retireDirectoryGrants: AuthzApi["retireDirectoryGrants"] = (a) =>
    this.#grants.retireDirectoryGrants(a);
  findDirectoryCausedChanges: AuthzApi["findDirectoryCausedChanges"] = (a) =>
    this.#grants.findDirectoryCausedChanges(a);
  offboardMember: AuthzApi["offboardMember"] = (a) => this.#grants.offboardMember(a);
  defineRole: AuthzApi["defineRole"] = (a) => this.#grants.defineRole(a);
  deleteRole: AuthzApi["deleteRole"] = (a) => this.#grants.deleteRole(a);
  createBinding: AuthzApi["createBinding"] = (a) => this.#grants.createBinding(a);
  updateBinding: AuthzApi["updateBinding"] = (a) => this.#grants.updateBinding(a);
  // A patch changed a row the service already read, so projection lag cannot explain its
  // absence: nothing the caller can act on, so a plain Error (ADR-045).
  updateRoleBinding: AuthzApi["updateRoleBinding"] = async (a) => {
    const updated = await this.#grants.updateBinding(a);
    const rows = await this.#permissions.listManagedBindingsForOrganization({
      organizationId: a.organizationId,
    });
    const binding = rows.find((row) => row.id === updated.id);
    if (!binding) throw new Error(`Role binding ${updated.id} was written but does not read back`);

    return bindingWire(binding);
  };
  deleteBinding: AuthzApi["deleteBinding"] = (a) => this.#grants.deleteBinding(a);
  listGrants: AuthzApi["listGrants"] = (a) => this.#grants.listGrants(a);
  getGrant: AuthzApi["getGrant"] = (a) => this.#grants.getGrant(a);
  createGrant: AuthzApi["createGrant"] = (a) => this.#grants.createGrant(a);
  changeGrantRole: AuthzApi["changeGrantRole"] = (a) => this.#grants.changeGrantRole(a);
  revokeGrant: AuthzApi["revokeGrant"] = (a) => this.#grants.revokeGrant(a);
  findPermissionsBeyondCaller: AuthzApi["findPermissionsBeyondCaller"] = (a) =>
    this.#permissions.findPermissionsBeyondCaller(a);
  applyMemberBindings: AuthzApi["applyMemberBindings"] = (a) => this.#grants.applyMemberBindings(a);

  registeredMigrations(): readonly SystemMigration[] {
    if (!this.#migration) {
      throw new Error(
        "This AuthzModule was composed from already-built services, so it holds no migration: " +
          "compose it through AuthzModule.create to answer its registered migrations.",
      );
    }
    return [this.#migration];
  }

  private platformOperators(): AuthzPlatformOperatorsService {
    if (!this.#platformOperators) {
      throw new Error(
        "This AuthzModule was composed from already-built services, so it holds no platform " +
          "tier: compose it through AuthzModule.create to grant, revoke or list operators.",
      );
    }
    return this.#platformOperators;
  }

  private admissions(): AuthzAdmissionService {
    if (!this.#admissions) {
      throw new Error(
        "This AuthzModule was composed from already-built services, so it holds no admission " +
          "repository: compose it through AuthzModule.create to read or clear an admission.",
      );
    }
    return this.#admissions;
  }
}

function authzRuntimeConfig(config: AuthzServerConfig): {
  cacheEnabled: () => boolean;
  demoProjectId: () => string | undefined;
} {
  return {
    cacheEnabled: () => config.epochCacheEnabled,
    demoProjectId: () => config.demoProjectId,
  };
}
