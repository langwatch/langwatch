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
import { toLedgerActor, type Actor, type LedgerActor } from "@langwatch/actor";
import {
  AuthzGrantsService as AuthzGrantsServiceContract,
  DuplicateGrantError,
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
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzRevokeBindingsWhereOutput,
  type AuthzRevokeGrantInput,
  type AuthzRevokeResourceGrantsInput,
  type AuthzScopeRef,
  type AuthzUpdateGrantInput,
  type AuthzUpdateBindingInput,
  type GrantPrincipal,
  type GrantRole,
  type GrantableAuthzScopeRef,
  isRegistryPermission,
  scopeOrganizationId,
} from "@langwatch/authz-contract";
import type { AuthzCompatibilityLedgerPort } from "../ports/authz-compatibility-ledger.port";
import type { AuthzEpochPort } from "../ports/authz-epoch.port";
import type { AuthzBindingRepository } from "../repositories/authz-binding.repository";
import type {
  AuthzGrantRepository,
  BindingPrincipalWhere,
  RoleBindingWrite,
} from "../repositories/authz-grant.repository";
import { AuthzGrantGuardsService } from "./authz-grant-guards.service";
import { AuthzBindingWriterService } from "./authz-binding-writer.service";
import { AuthzOffboardingService } from "./authz-offboarding.service";

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
  bindings: AuthzBindingRepository;
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
    return new AuthzGrantsService(
      options,
      AuthzBindingWriterService.create({
        bindings: options.bindings,
        ledger: options.ledger,
        newBindingId: options.newBindingId,
      }),
      AuthzOffboardingService.create(options.repository),
      new AuthzGrantGuardsService(options.repository),
    );
  }

  private constructor(
    private readonly options: AuthzGrantsServiceOptions,
    private readonly bindingWriter: AuthzBindingWriterService,
    private readonly offboarding: AuthzOffboardingService,
    private readonly guards: AuthzGrantGuardsService,
  ) {
    super();
  }

  /** INSERT (who, role, where) — visible on the next check. */
  async attach({
    actor,
    who,
    role,
    where,
    source = "grants-service",
  }: AuthzAttachGrantRequest): Promise<{ bindingId: string }> {
    if (where.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION, {
        kind: where.kind,
        resourceId: where.id,
      });
    }

    const organizationId = scopeOrganizationId(where);
    const { repository } = this.options;
    await this.guards.assertScopeBelongsToOrganization({ where, organizationId });
    await this.guards.assertRoleUsable({ role, organizationId });

    const row = this.bindingRow({ who, role, where, organizationId });
    try {
      await repository.createBinding({
        row,
        actor: this.writeActor(actor),
        source,
      });
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
  async revoke({ actor, bindingId, organizationId }: AuthzRevokeGrantInput): Promise<void> {
    const { repository } = this.options;
    await this.guards.assertBindingInOrganization({ bindingId, organizationId });
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
    await this.guards.assertScopeBelongsToOrganization({ where: to, organizationId });
    await this.guards.assertRoleUsable({ role, organizationId });
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
  }: AuthzOffboardRequest): Promise<AuthzOffboardOutput> {
    const result = await this.offboarding.offboard({
      actor: this.writeActor(actor),
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

  async attachBindings(args: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput> {
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

  private writeActor(actor: { userId: string } | Actor): LedgerActor {
    return toLedgerActor("userId" in actor ? { type: "user", id: actor.userId } : actor);
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
    if (bindingId) {
      errorMeta.bindingId = bindingId;
    }

    if (code === "role_binding_already_exists") {
      throw new DuplicateGrantError(errorMeta);
    }

    if (code === "role_binding_not_found") {
      throw AuthzGrantGuardsService.bindingNotFound(errorMeta);
    }

    throw error;
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
