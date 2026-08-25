/**
 * ADR-092 §11 (setting) + §10 (offboarding) — the one write surface for
 * grants. Every mutation validates against the registry/tenancy and bumps
 * the org's authz epoch so caches and passports die on the caller's next
 * request. Storage is behind AuthzGrantRepository — since delivery-plan
 * PR 2 the app's implementation emits grants ledger commands (the actor
 * every write carries is stamped onto the fact), and the audit trail is the
 * ledger's insert-only subscriber (decision 17), not a direct write here.
 * This service owns validation, failure naming, and the offboarding proof.
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  AuthzGrantsService as AuthzGrantsServiceContract,
  DuplicateGrantError,
  GrantValidationError,
  OffboardIncompleteError,
  type AuthzAttachGrantInput,
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  type AuthzAttachResourceGrantInput,
  type AuthzChangeBindingRoleInput,
  type AuthzDefineRoleInput,
  type AuthzDeleteRoleInput,
  type AuthzOffboardMemberInput,
  type AuthzOffboardInput,
  type AuthzOffboardOutput,
  type AuthzReplaceGrantInput,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzRevokeBindingsWhereOutput,
  type AuthzRevokeGrantInput,
  type AuthzRevokeResourceGrantsInput,
  type AuthzScopeRef,
  type AuthzUpdateGrantInput,
  type GrantPrincipal,
  type GrantRole,
  type GrantableAuthzScopeRef,
  type OffboardCounts,
  isRegistryPermission,
  scopeOrganizationId,
} from "@langwatch/authz-contract";
import type { AuthzCompatibilityLedgerPort } from "../ports/authz-compatibility-ledger.port";
import type { AuthzEpochPort } from "../ports/authz-epoch.port";
import type {
  AuthzGrantRepository,
  BindingPrincipalWhere,
  RoleBindingWrite,
} from "../repositories/authz-grant.repository";
import type { AuthzReadRepository } from "../repositories/authz-read.repository";
import { AuthzCollectorService } from "./authz-collector.service";

/**
 * The app-owned effect seams, composed once in the app's runtime
 * (the application AuthZ composition root): the audit writer, the
 * KSUID minter for binding ids, the redis-backed epoch bump, and the
 * collector factory the offboarding proof re-binds to its transaction
 * (injected rather than constructed so this module keeps no value import of
 * the collector).
 */
export type AuthzGrantsServiceOptions = {
  repository: AuthzGrantRepository;
  /** Private compatibility writer; its operations surface only through this service. */
  ledger: AuthzCompatibilityLedgerPort;
  epoch: AuthzEpochPort;
  newBindingId: () => string;
};

type AuthzAttachGrantRequest = Omit<AuthzAttachGrantInput, "where"> & {
  where: AuthzScopeRef;
};

type AuthzReplaceGrantRequest = Omit<AuthzReplaceGrantInput, "from" | "to"> & {
  from: AuthzScopeRef;
  to: AuthzScopeRef;
};

export type GrantableScope = GrantableAuthzScopeRef;

const SCOPE_TYPE_FOR_REF = {
  project: "PROJECT",
  team: "TEAM",
  organization: "ORGANIZATION",
} as const;

const RESOURCE_SCOPE_REJECTION =
  "Resource-tier access is granted by sharing the resource, not by a role binding";

export class AuthzGrantsService extends AuthzGrantsServiceContract {
  static create(options: AuthzGrantsServiceOptions): AuthzGrantsService {
    return new AuthzGrantsService(options);
  }

  private constructor(private readonly options: AuthzGrantsServiceOptions) {
    super();
  }

  /** INSERT (who, role, where) — visible on the next check. */
  async attach({
    actor,
    who,
    role,
    where,
  }: AuthzAttachGrantRequest): Promise<{ bindingId: string }> {
    if (where.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION, {
        kind: where.kind,
        resourceId: where.id,
      });
    }
    const organizationId = scopeOrganizationId(where);
    const { repository } = this.options;
    await this.assertScopeBelongsToOrganization({
      repository,
      where,
      organizationId,
    });
    await this.assertRoleUsable({ repository, role, organizationId });

    const row = this.bindingRow({ who, role, where, organizationId });
    try {
      await repository.createBinding({ row, actor: this.writeActor(actor) });
    } catch (error) {
      this.rethrowKnownWriteFailure(error, {
        scopeType: where.type,
        scopeId: where.id,
      });
    }

    await this.options.epoch.bump({ organizationId });
    return { bindingId: row.bindingId };
  }

  /** UPDATE the row's role — visible on the next check. */
  async update({
    actor,
    bindingId,
    organizationId,
    role,
  }: AuthzUpdateGrantInput): Promise<void> {
    const { repository } = this.options;
    await this.assertBindingInOrganization({
      repository,
      bindingId,
      organizationId,
    });
    await this.assertRoleUsable({ repository, role, organizationId });
    try {
      await repository.updateBindingRole({
        bindingId,
        organizationId,
        role: "customRoleId" in role ? "CUSTOM" : role.builtin,
        customRoleId: "customRoleId" in role ? role.customRoleId : null,
        actor: this.writeActor(actor),
      });
    } catch (error) {
      // A role change can collide with a sibling binding the principal
      // already holds at the same scope - same knowable failure as attach.
      this.rethrowKnownWriteFailure(error, { bindingId });
    }
    await this.options.epoch.bump({ organizationId });
  }

  /** DELETE the row — access gone on the next check. */
  async revoke({
    actor,
    bindingId,
    organizationId,
  }: AuthzRevokeGrantInput): Promise<void> {
    const { repository } = this.options;
    await this.assertBindingInOrganization({
      repository,
      bindingId,
      organizationId,
    });
    try {
      await repository.deleteBinding({
        bindingId,
        organizationId,
        actor: this.writeActor(actor),
      });
    } catch (error) {
      this.rethrowKnownWriteFailure(error, { bindingId });
    }
    await this.options.epoch.bump({ organizationId });
  }

  /**
   * The REDUCE verb (ADR-092 §3): atomically replace a broad grant with a
   * narrower one — never a second binding fighting the first. The
   * repository runs the delete and the create as one transaction.
   */
  async replace({
    actor,
    who,
    from,
    to,
    role,
  }: AuthzReplaceGrantRequest): Promise<{ bindingId: string }> {
    if (from.type === "resource" || to.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION);
    }
    const organizationId = scopeOrganizationId(from);
    if (scopeOrganizationId(to) !== organizationId) {
      throw new GrantValidationError("replace() must stay within one organization");
    }
    const { repository } = this.options;
    await this.assertScopeBelongsToOrganization({
      repository,
      where: to,
      organizationId,
    });
    await this.assertRoleUsable({ repository, role, organizationId });
    const row = this.bindingRow({ who, role, where: to, organizationId });
    try {
      await repository.replaceBinding({
        deleteWhere: {
          organizationId,
          scopeType: SCOPE_TYPE_FOR_REF[from.type],
          scopeId: from.id,
          principal: this.principalWhere(who),
        },
        create: row,
        actor: this.writeActor(actor),
      });
    } catch (error) {
      this.rethrowKnownWriteFailure(error, {
        scopeType: to.type,
        scopeId: to.id,
      });
    }
    await this.options.epoch.bump({ organizationId });
    return { bindingId: row.bindingId };
  }

  /**
   * ADR-092 §10 — remove every grant source for a user in one transaction,
   * proven inside it (see ./offboard.ts). Returns the manifest of what
   * still needs a human decision.
   */
  async offboard({
    actor,
    userId,
    organizationId,
  }: AuthzOffboardInput): Promise<AuthzOffboardOutput> {
    const result = await this.offboardUserFromOrganization({
      repository: this.options.repository,
      actor: this.writeActor(actor),
      userId,
      organizationId,
    });

    await this.options.epoch.bump({ organizationId });

    return result;
  }

  async attachBindings(
    args: AuthzAttachBindingsInput,
  ): Promise<AuthzAttachBindingsOutput> {
    return this.options.ledger.attachBindings(args);
  }

  async attachResourceGrant(args: AuthzAttachResourceGrantInput): Promise<void> {
    return this.options.ledger.attachResourceGrant(args);
  }

  async revokeResourceGrants(args: AuthzRevokeResourceGrantsInput): Promise<void> {
    return this.options.ledger.revokeResourceGrants(args);
  }

  async changeBindingRole(args: AuthzChangeBindingRoleInput): Promise<void> {
    return this.options.ledger.changeBindingRole(args);
  }

  async revokeBindings(args: AuthzRevokeBindingsInput): Promise<void> {
    return this.options.ledger.revokeBindings(args);
  }

  async revokeBindingsWhere(
    args: AuthzRevokeBindingsWhereInput,
  ): Promise<AuthzRevokeBindingsWhereOutput> {
    return this.options.ledger.revokeBindingsWhere(args);
  }

  async offboardMember(args: AuthzOffboardMemberInput): Promise<void> {
    return this.options.ledger.offboardMember(args);
  }

  async defineRole(args: AuthzDefineRoleInput): Promise<void> {
    return this.options.ledger.defineRole(args);
  }

  async deleteRole(args: AuthzDeleteRoleInput): Promise<void> {
    return this.options.ledger.deleteRole(args);
  }

  private bindingRow({
    who,
    role,
    where,
    organizationId,
  }: {
    who: GrantPrincipal;
    role: GrantRole;
    where: GrantableScope;
    organizationId: string;
  }): RoleBindingWrite {
    return {
      bindingId: this.options.newBindingId(),
      organizationId,
      scopeType: SCOPE_TYPE_FOR_REF[where.type],
      scopeId: where.id,
      role: "customRoleId" in role ? "CUSTOM" : role.builtin,
      customRoleId: "customRoleId" in role ? role.customRoleId : null,
      principal: this.principalWhere(who),
    };
  }

  private writeActor(actor: { userId: string }): LedgerActor {
    return { type: "user", id: actor.userId };
  }

  private bindingNotFound(meta: Record<string, unknown>): GrantValidationError {
    return new GrantValidationError("Role binding not found", meta);
  }

  private tryPortErrorCode(error: unknown): string | undefined {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
    ) {
      return (error as { code: string }).code;
    }
    return undefined;
  }

  private rethrowKnownWriteFailure(
    error: unknown,
    { bindingId, ...meta }: { bindingId?: string } & Record<string, unknown>,
  ): never {
    const code = this.tryPortErrorCode(error);
    const errorMeta = { ...meta };
    if (bindingId) errorMeta.bindingId = bindingId;
    if (code === "role_binding_already_exists") {
      throw new DuplicateGrantError(errorMeta);
    }
    if (code === "role_binding_not_found") {
      throw this.bindingNotFound(errorMeta);
    }
    throw error;
  }

  private async assertBindingInOrganization({
    repository,
    bindingId,
    organizationId,
  }: {
    repository: AuthzGrantRepository;
    bindingId: string;
    organizationId: string;
  }): Promise<void> {
    const binding = await repository.tryFindBinding({ bindingId });
    if (!binding || binding.organizationId !== organizationId) {
      throw this.bindingNotFound({ bindingId });
    }
  }

  private async assertScopeBelongsToOrganization({
    repository,
    where,
    organizationId,
  }: {
    repository: AuthzGrantRepository;
    where: GrantableScope;
    organizationId: string;
  }): Promise<void> {
    if (where.type === "organization") return;
    if (where.type === "team") {
      const team = await repository.tryFindTeamOrganization({ teamId: where.id });
      if (team?.organizationId !== organizationId) {
        throw new GrantValidationError("Team is not in this organization", {
          teamId: where.id,
        });
      }
      return;
    }
    const lineage = await repository.tryFindProjectLineage({
      projectId: where.id,
    });
    if (lineage?.organizationId !== organizationId || lineage.teamId !== where.teamId) {
      throw new GrantValidationError("Project is not in this scope", {
        projectId: where.id,
      });
    }
  }

  private async assertRoleUsable({
    repository,
    role,
    organizationId,
  }: {
    repository: AuthzGrantRepository;
    role: GrantRole;
    organizationId: string;
  }): Promise<void> {
    if (!("customRoleId" in role)) return;
    const { customRoleId } = role;
    const customRole = await repository.tryFindCustomRole({ customRoleId });
    if (!customRole || customRole.organizationId !== organizationId) {
      throw new GrantValidationError("Custom role does not belong to this organization", {
        customRoleId,
      });
    }
    const unknownPermissions = Array.isArray(customRole.permissions)
      ? customRole.permissions
          .filter((value) => typeof value !== "string" || !isRegistryPermission(value))
          .map((value) => String(value))
      : [];
    if (unknownPermissions.length > 0) {
      throw new GrantValidationError("Custom role lists permissions that do not exist", {
        customRoleId,
        unknownPermissions,
      });
    }
  }

  private principalWhere(who: GrantPrincipal): BindingPrincipalWhere {
    switch (who.type) {
      case "user":
        return { userId: who.id };
      case "group":
        return { groupId: who.id };
      case "apiKey":
        return { apiKeyId: who.id };
      default: {
        const unreachable: never = who;
        throw new Error(`unhandled grant principal: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  private async offboardUserFromOrganization({
    repository,
    actor,
    userId,
    organizationId,
  }: {
    repository: AuthzGrantRepository;
    actor: LedgerActor;
    userId: string;
    organizationId: string;
  }): Promise<{
    removed: OffboardCounts;
    needsHumanDecision: {
      ownedApiKeys: Array<{ id: string; name: string }>;
      personalTeams: Array<{ id: string; name: string }>;
    };
  }> {
    const removed = await repository.offboardUser({
      userId,
      organizationId,
      actor,
      prove: (reader) => this.proveNothingResolves({ reader, userId, organizationId }),
    });
    const [ownedApiKeys, personalTeams] = await Promise.all([
      repository.findOwnedApiKeys({ userId, organizationId }),
      repository.findPersonalTeams({ userId, organizationId }),
    ]);
    return { removed, needsHumanDecision: { ownedApiKeys, personalTeams } };
  }

  private async proveNothingResolves({
    reader,
    userId,
    organizationId,
  }: {
    reader: AuthzReadRepository;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const grants = await AuthzCollectorService.create({ reader }).collectGrants({
      principal: { type: "user", id: userId },
      organizationId,
    });
    if (
      grants.isOrgMember ||
      grants.bindings.length > 0 ||
      grants.legacyTeamMemberships.length > 0
    ) {
      throw new OffboardIncompleteError({
        userId,
        organizationId,
        remainingBindings: grants.bindings.length,
        remainingLegacyRows: grants.legacyTeamMemberships.length,
        stillOrgMember: grants.isOrgMember,
      });
    }
  }
}
