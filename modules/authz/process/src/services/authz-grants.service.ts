/**
 * ADR-092 §11 (setting) + §10 (offboarding) — the one write surface for
 * grants. Every mutation validates against the registry/tenancy and bumps the org's authz
 * epoch so caches and passports die on the caller's next request.
 */
import type { Actor } from "@langwatch/authorization";
import {
  AuthzGrantsService as AuthzGrantsServiceContract,
  GrantValidationError,
  type GrantEventSource,
  type AuthzAttachGrantInput,
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  type AuthzApplyMemberBindingsInput,
  type AuthzAttachResourceGrantInput,
  type AuthzBindingMutationSuccess,
  type AuthzChangeBindingRoleInput,
  type AuthzCreateBindingInput,
  type AuthzCreateBindingOutput,
  type AuthzDefineRoleInput,
  type AuthzDeleteBindingInput,
  type AuthzDeleteRoleInput,
  type AuthzOffboardMemberInput,
  type AuthzOffboardInput,
  type AuthzOffboardOutput,
  type AuthzReplaceGrantInput,
  type AuthzDirectoryCausedChangesInput,
  type AuthzDirectoryCausedChangesOutput,
  type AuthzRetireDirectoryGrantsInput,
  type AuthzRetireDirectoryGrantsOutput,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzRevokeBindingsWhereOutput,
  type AuthzRevokeGrantInput,
  type AuthzRevokeResourceGrantsInput,
  type AuthzScopeRef,
  type AuthzUpdateGrantInput,
  type AuthzUpdateBindingInput,
  type GrantPrincipal,
  scopeOrganizationId,
  type AuthzChangeGrantRoleInput,
  type AuthzCreateGrantInput,
  type AuthzGetGrantInput,
  type AuthzListGrantsInput,
  type AuthzRevokeGrantByIdInput,
  type Grant,
  type GrantPage,
  type GrantRevoked,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";

import type { AuthzCompatibilityLedger } from "../app/authz.app.ts";
import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type {
  AuthzGrantRepository,
  BindingPrincipalWhere,
} from "../repositories/authz-grant.repository.ts";
import type { AuthzManagedGrantRepository } from "../repositories/authz-managed-grant.repository.ts";
import {
  RESOURCE_SCOPE_REJECTION,
  SCOPE_TYPE_FOR_REF,
  grantLedgerActor,
  grantWriteRow,
} from "../rules/grant-write.rules.ts";
import { AuthzDirectoryGrantsService } from "./authz-directory-grants.service.ts";
import { AuthzGrantGuardsService } from "./authz-grant-guards.service.ts";
import { AuthzGrantManagementService } from "./authz-grant-management.service.ts";
import {
  AuthzGrantWriterService,
  type AuthzGrantWriterPermissions,
} from "./authz-grant-writer.service.ts";
import {
  AuthzMemberOffboardedNoticeService,
  type AuthzMemberOffboardedNotice,
} from "./authz-member-offboarded-notice.service.ts";
import { AuthzOffboardingService } from "./authz-offboarding.service.ts";

/**
 * The app-owned effect seams, composed once in the app's runtime (the application AuthZ
 * composition root): the audit writer, the KSUID minter for binding ids, the redis-backed
 * epoch bump, and the collector factory the offboarding proof re-binds to its transaction
 */
type AuthzGrantsServiceOptions = {
  repository: AuthzGrantRepository;
  /** Private compatibility writer; its operations surface only through this service. */
  ledger: AuthzCompatibilityLedger;
  epoch: AuthzEpochRepository;
  newBindingId: () => string;
  bindings: AuthzManagedGrantRepository;
  /** The permission side's reads the writer's guards need (escalation, limit, last admin). */
  permissions: AuthzGrantWriterPermissions;
  /** Absent where nothing offboards; an unconnected notice refuses loudly when one does. */
  offboarded?: AuthzMemberOffboardedNotice;
};

type AuthzAttachGrantRequest = Omit<AuthzAttachGrantInput, "actor" | "where"> & {
  actor: { userId: string } | Actor;
  where: AuthzScopeRef;
  source?: GrantEventSource;
};

type AuthzReplaceGrantRequest = Omit<AuthzReplaceGrantInput, "from" | "to"> & {
  from: AuthzScopeRef;
  to: AuthzScopeRef;
};

type AuthzOffboardRequest = Omit<AuthzOffboardInput, "actor"> & {
  actor: { userId: string } | Actor;
};

export class AuthzGrantsService extends AuthzGrantsServiceContract {
  static create(options: AuthzGrantsServiceOptions): AuthzGrantsService {
    const bindingWriter = AuthzGrantWriterService.create({
      bindings: options.bindings,
      ledger: options.ledger,
      newBindingId: options.newBindingId,
      permissions: options.permissions,
    });

    return new AuthzGrantsService({
      options,
      bindingWriter,
      grantManagement: AuthzGrantManagementService.create({
        writer: bindingWriter,
        permissions: options.permissions,
      }),
      offboarding: AuthzOffboardingService.create({
        repository: options.repository,
        offboarded: options.offboarded ?? AuthzMemberOffboardedNoticeService.create(),
      }),
      guards: AuthzGrantGuardsService.create({ repository: options.repository }),
    });
  }

  private readonly options: AuthzGrantsServiceOptions;
  private readonly bindingWriter: AuthzGrantWriterService;
  private readonly grantManagement: AuthzGrantManagementService;
  private readonly offboarding: AuthzOffboardingService;
  private readonly guards: AuthzGrantGuardsService;
  private readonly directoryGrants: AuthzDirectoryGrantsService;

  private constructor({
    options,
    bindingWriter,
    grantManagement,
    offboarding,
    guards,
  }: {
    options: AuthzGrantsServiceOptions;
    bindingWriter: AuthzGrantWriterService;
    grantManagement: AuthzGrantManagementService;
    offboarding: AuthzOffboardingService;
    guards: AuthzGrantGuardsService;
  }) {
    super();
    this.options = options;
    this.bindingWriter = bindingWriter;
    this.grantManagement = grantManagement;
    this.offboarding = offboarding;
    this.guards = guards;
    this.directoryGrants = AuthzDirectoryGrantsService.create(options);
  }

  /** INSERT (who, role, where) — visible on the next check. */
  async attach({
    actor,
    who,
    role,
    where,
    source = "grants-service",
    expiresAtMs,
  }: AuthzAttachGrantRequest): Promise<{ bindingId: string }> {
    if (where.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION, {
        kind: where.kind,
        resourceId: where.id,
      });
    }

    AuthzGrantGuardsService.assertExpiryInFuture({
      expiresAtMs,
      nowMs: this.nowMs(),
      meta: { scopeType: where.type, scopeId: where.id },
    });
    const organizationId = scopeOrganizationId(where);
    const { repository } = this.options;
    await this.guards.assertScopeBelongsToOrganization({ where, organizationId });
    await this.guards.assertRoleUsable({ role, organizationId });

    const row = grantWriteRow({
      bindingId: this.options.newBindingId(),
      principal: this.principalWhere(who),
      role,
      where,
      organizationId,
      expiresAtMs,
    });
    try {
      await repository.createBinding({
        row,
        actor: grantLedgerActor(actor),
        source,
      });
    } catch (error) {
      AuthzGrantGuardsService.rethrowKnownWriteFailure(error, {
        scopeType: where.type,
        scopeId: where.id,
      });
    }

    await this.options.epoch.bump({ organizationId });

    return { bindingId: row.bindingId };
  }

  /** UPDATE the row's role — visible on the next check. */
  async update({ actor, bindingId, organizationId, role }: AuthzUpdateGrantInput): Promise<void> {
    const { repository } = this.options;
    await this.guards.assertBindingInOrganization({ bindingId, organizationId });
    await this.guards.assertRoleUsable({ role, organizationId });
    try {
      await repository.updateBindingRole({
        bindingId,
        organizationId,
        role: "customRoleId" in role ? "CUSTOM" : role.builtin,
        customRoleId: "customRoleId" in role ? role.customRoleId : null,
        actor: grantLedgerActor(actor),
      });
    } catch (error) {
      // A role change can collide with a sibling binding the principal
      // already holds at the same scope - same knowable failure as attach.
      AuthzGrantGuardsService.rethrowKnownWriteFailure(error, { bindingId });
    }

    await this.options.epoch.bump({ organizationId });
  }

  /** DELETE the row — access gone on the next check. */
  async revoke({ actor, bindingId, organizationId }: AuthzRevokeGrantInput): Promise<void> {
    const { repository } = this.options;
    await this.guards.assertBindingInOrganization({ bindingId, organizationId });
    try {
      await repository.deleteBinding({
        bindingId,
        organizationId,
        actor: grantLedgerActor(actor),
      });
    } catch (error) {
      AuthzGrantGuardsService.rethrowKnownWriteFailure(error, { bindingId });
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
    expiresAtMs,
  }: AuthzReplaceGrantRequest): Promise<{ bindingId: string }> {
    if (from.type === "resource" || to.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION);
    }

    // Before the source is revoked: an expired replacement would be a removal shaped as an edit.
    AuthzGrantGuardsService.assertExpiryInFuture({
      expiresAtMs,
      nowMs: this.nowMs(),
      meta: { scopeType: to.type, scopeId: to.id },
    });

    const organizationId = scopeOrganizationId(from);
    if (scopeOrganizationId(to) !== organizationId) {
      throw new GrantValidationError("replace() must stay within one organization");
    }

    const { repository } = this.options;
    await this.guards.assertScopeBelongsToOrganization({ where: to, organizationId });
    await this.guards.assertRoleUsable({ role, organizationId });
    const row = grantWriteRow({
      bindingId: this.options.newBindingId(),
      principal: this.principalWhere(who),
      role,
      where: to,
      organizationId,
      expiresAtMs,
    });
    try {
      await repository.replaceBinding({
        deleteWhere: {
          organizationId,
          scopeType: SCOPE_TYPE_FOR_REF[from.type],
          scopeId: from.id,
          principal: this.principalWhere(who),
        },
        create: row,
        actor: grantLedgerActor(actor),
      });
    } catch (error) {
      AuthzGrantGuardsService.rethrowKnownWriteFailure(error, {
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
  }: AuthzOffboardRequest): Promise<AuthzOffboardOutput> {
    const result = await this.offboarding.offboard({
      actor: grantLedgerActor(actor),
      userId,
      organizationId,
    });

    await this.options.epoch.bump({ organizationId });

    return result;
  }

  /**
   * Retire this organization's cached authorization snapshots without a grant
   * write. A membership being disabled or re-enabled changes what the person
   * may do but touches no binding, so nothing else bumps the epoch for it.
   */
  async invalidateOrganization({ organizationId }: { organizationId: string }): Promise<void> {
    await this.options.epoch.bump({ organizationId });
  }

  async attachBindings({
    caller,
    ...args
  }: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput> {
    const nowMs = this.nowMs();
    for (const binding of args.bindings) {
      AuthzGrantGuardsService.assertExpiryInFuture({
        expiresAtMs: binding.expiresAtMs,
        nowMs,
        meta: { scopeType: binding.scopeType, scopeId: binding.scopeId },
      });
    }
    await this.bindingWriter.assertBindingsWithinCaller({
      organizationId: args.organizationId,
      caller,
      bindings: args.bindings,
    });
    return this.options.ledger.attachBindings(args);
  }

  async attachResourceGrant(args: AuthzAttachResourceGrantInput): Promise<void> {
    return this.options.ledger.attachResourceGrant(args);
  }

  async revokeResourceGrants(args: AuthzRevokeResourceGrantsInput): Promise<void> {
    return this.options.ledger.revokeResourceGrants(args);
  }

  findLiveSharedProjectGrants: AuthzCompatibilityLedger["findLiveSharedProjectGrants"] = (args) =>
    this.options.ledger.findLiveSharedProjectGrants(args);

  attachSharedProjectGrant: AuthzCompatibilityLedger["attachSharedProjectGrant"] = (args) =>
    this.options.ledger.attachSharedProjectGrant(args);

  awaitSharedProjectGrants: AuthzCompatibilityLedger["awaitSharedProjectGrants"] = (args) =>
    this.options.ledger.awaitSharedProjectGrants(args);

  revokeSharedProjectGrants: AuthzCompatibilityLedger["revokeSharedProjectGrants"] = (args) =>
    this.options.ledger.revokeSharedProjectGrants(args);

  async changeBindingRole({ caller, ...args }: AuthzChangeBindingRoleInput): Promise<void> {
    await this.bindingWriter.assertRoleChangeWithinCaller({ ...args, caller });
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

  /** The directory's own organization grants, retired; see AuthzDirectoryGrantsService. */
  retireDirectoryGrants(
    args: AuthzRetireDirectoryGrantsInput,
  ): Promise<AuthzRetireDirectoryGrantsOutput> {
    return this.directoryGrants.retireDirectoryGrants(args);
  }

  findDirectoryCausedChanges(
    args: AuthzDirectoryCausedChangesInput,
  ): Promise<AuthzDirectoryCausedChangesOutput> {
    return this.directoryGrants.findDirectoryCausedChanges(args);
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

  createBinding(args: AuthzCreateBindingInput): Promise<AuthzCreateBindingOutput> {
    return this.bindingWriter.create(args);
  }

  updateBinding(args: AuthzUpdateBindingInput): Promise<AuthzCreateBindingOutput> {
    return this.bindingWriter.update(args);
  }

  deleteBinding(args: AuthzDeleteBindingInput): Promise<AuthzBindingMutationSuccess> {
    return this.bindingWriter.delete(args);
  }

  applyMemberBindings(args: AuthzApplyMemberBindingsInput): Promise<AuthzBindingMutationSuccess> {
    return this.bindingWriter.applyMemberBindings(args);
  }

  listGrants(args: AuthzListGrantsInput): Promise<GrantPage> {
    return this.grantManagement.list(args);
  }

  getGrant(args: AuthzGetGrantInput): Promise<Grant> {
    return this.grantManagement.get(args);
  }

  createGrant(args: AuthzCreateGrantInput): Promise<Grant> {
    return this.grantManagement.create(args);
  }

  changeGrantRole(args: AuthzChangeGrantRoleInput): Promise<Grant> {
    return this.grantManagement.changeRole(args);
  }

  revokeGrant(args: AuthzRevokeGrantByIdInput): Promise<GrantRevoked> {
    return this.grantManagement.revoke(args);
  }

  private nowMs(): number {
    return nowInstant().epochMilliseconds;
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
}
