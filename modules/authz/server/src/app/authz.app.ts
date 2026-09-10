import type {
  AuthzApi,
  AuthzAttachBindingsInput,
  AuthzAttachBindingsOutput,
  AuthzAttachResourceGrantInput,
  AuthzCaller,
  AuthzChangeBindingRoleInput,
  AuthzDefineRoleInput,
  AuthzDeleteRoleInput,
  AuthzGrantsService,
  AuthzOffboardMemberInput,
  AuthzPermission,
  AuthzRevokeBindingsInput,
  AuthzRevokeBindingsWhereInput,
  AuthzRevokeBindingsWhereOutput,
  AuthzRevokeResourceGrantsInput,
  AuthzService,
  EffectivePermissions,
} from "@langwatch/authz-contract";
import { AuthzApi as AuthzApiToken } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import { AuthzGrantIdentity } from "../services/authz-grant-identity.service.ts";
import {
  PostgresAuthzAdapter,
  type PostgresAuthzAdapterOptions,
} from "./postgres-authz.build.ts";

/**
 * Private server-side compatibility seam for callers whose legacy operations
 * cannot yet be expressed by the smaller high-level grant verbs. It remains
 * behind AuthzGrantsService and is never exported from the package root.
 */
export interface AuthzCompatibilityLedger {
  attachBindings(args: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput>;
  attachResourceGrant(args: AuthzAttachResourceGrantInput): Promise<void>;
  revokeResourceGrants(args: AuthzRevokeResourceGrantsInput): Promise<void>;
  changeBindingRole(args: AuthzChangeBindingRoleInput): Promise<void>;
  revokeBindings(args: AuthzRevokeBindingsInput): Promise<void>;
  revokeBindingsWhere(args: AuthzRevokeBindingsWhereInput): Promise<AuthzRevokeBindingsWhereOutput>;
  offboardMember(args: AuthzOffboardMemberInput): Promise<void>;
  defineRole(args: AuthzDefineRoleInput): Promise<void>;
  deleteRole(args: AuthzDeleteRoleInput): Promise<void>;
}

export type AuthzInfrastructure = Omit<PostgresAuthzAdapterOptions, "repositories">;
export type AuthzSetup = FeatureSetup<Readonly<{}>, AuthzInfrastructure, undefined> &
  Readonly<{ repositories: AuthzRepositories }>;

/** The composed callable authorization boundary. */
export class AuthzApp implements AuthzApi {
  static readonly contract = AuthzApiToken;
  static readonly dependencies = {} as const;
  #permissions: AuthzService;
  #grants: AuthzGrantsService;
  private constructor(permissions: AuthzService, grants: AuthzGrantsService) {
    this.#permissions = permissions;
    this.#grants = grants;
  }
  static create(setup: AuthzSetup): AuthzApp {
    const built = PostgresAuthzAdapter.create({
      ...setup.infrastructure,
      repositories: setup.repositories,
    }).build();
    return new AuthzApp(built.authz, built.grants);
  }

  /**
   * Binds the callable boundary to services already constructed by a process
   * composition root. This keeps every API client on the same authorization
   * and grants graph as the legacy transport collaborators.
   */
  static fromServices(input: { permissions: AuthzService; grants: AuthzGrantsService }): AuthzApp {
    return new AuthzApp(input.permissions, input.grants);
  }
  async effectivePermissionsFor(
    input: Readonly<{ projectId?: string; organizationId?: string }>,
    by: AuthzCaller,
  ): Promise<EffectivePermissions> {
    const scope = await this.tryResolveScope({
      projectId: input.projectId,
      organizationId: input.projectId ? undefined : input.organizationId,
    });
    if (!scope) return { scope: null, permissions: [] };
    return {
      scope: { type: scope.type, id: scope.id },
      permissions: await this.effectivePermissions({
        principal: { type: "user", id: by.id },
        scope,
      }),
    };
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
  tryResolveScope: AuthzApi["tryResolveScope"] = (a) => this.#permissions.tryResolveScope(a);
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
  listTeamMemberBindings: AuthzApi["listTeamMemberBindings"] = (a) =>
    this.#permissions.listTeamMemberBindings(a);
  listBindingsForSynthesis: AuthzApi["listBindingsForSynthesis"] = (a) =>
    this.#permissions.listBindingsForSynthesis(a);
  listUserCreatedRoles: AuthzApi["listUserCreatedRoles"] = (a) =>
    this.#permissions.listUserCreatedRoles(a);
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
  hasProjectPermission(a: { userId: string; projectId: string; permission: AuthzPermission }) {
    return this.#permissions.hasPermission(a);
  }
  /**
   * The one derivation, answered for every module that writes a binding it
   * does not own the ledger for. It reads nothing and awaits nothing: the id
   * is a function of the grant's own content.
   */
  deriveGrantId: AuthzApi["deriveGrantId"] = (a) => AuthzGrantIdentity.deriveGrantId(a);
  attach: AuthzApi["attach"] = (a) => this.#grants.attach(a);
  update: AuthzApi["update"] = (a) => this.#grants.update(a);
  revoke: AuthzApi["revoke"] = (a) => this.#grants.revoke(a);
  replace: AuthzApi["replace"] = (a) => this.#grants.replace(a);
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
  offboardMember: AuthzApi["offboardMember"] = (a) => this.#grants.offboardMember(a);
  defineRole: AuthzApi["defineRole"] = (a) => this.#grants.defineRole(a);
  deleteRole: AuthzApi["deleteRole"] = (a) => this.#grants.deleteRole(a);
  createBinding: AuthzApi["createBinding"] = (a) => this.#grants.createBinding(a);
  updateBinding: AuthzApi["updateBinding"] = (a) => this.#grants.updateBinding(a);
  deleteBinding: AuthzApi["deleteBinding"] = (a) => this.#grants.deleteBinding(a);
  applyMemberBindings: AuthzApi["applyMemberBindings"] = (a) => this.#grants.applyMemberBindings(a);
}
