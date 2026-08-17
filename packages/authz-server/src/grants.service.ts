/**
 * ADR-092 §11 (setting) + §10 (offboarding) — the one write surface for
 * grants. Every mutation validates against the registry/tenancy, bumps the
 * org's authz epoch so caches and passports die on the caller's next
 * request, and emits an audit event. Storage is behind
 * AuthzGrantsRepository - the Prisma implementation (and its transactions)
 * lives in the app; ./grant-validation.ts owns what a write must satisfy,
 * and ./offboard.ts owns the offboarding transaction and its proof.
 *
 * Migration note (stage D0): the eight legacy RoleBinding write paths
 * (member add, invites, SCIM, groups, API keys, project creation, role
 * editor, better-auth hooks) route through this service as they migrate;
 * new code starts here.
 */
import { type AuthzScopeRef, scopeOrganizationId } from "@langwatch/authz";
import type { AuthzCollectorService } from "./authz-collector.service";
import type {
  AuthzGrantsRepository,
  OffboardCounts,
  RoleBindingWrite,
} from "./authz-grants.repository";
import type { AuthzReadRepository } from "./authz-read.repository";
import {
  assertBindingInOrganization,
  assertRoleUsable,
  assertScopeBelongsToOrganization,
  type GrantableScope,
  GrantValidationError,
  principalWhere,
  RESOURCE_SCOPE_REJECTION,
  rethrowKnownWriteFailure,
  SCOPE_TYPE_FOR_REF,
} from "./grant-validation";
import { offboardUserFromOrganization } from "./offboard";

/** The app's audit writer (EE) - every grant mutation records one event. */
export type AuthzAuditWriter = (entry: {
  userId: string;
  organizationId: string;
  action: string;
  metadata: Record<string, unknown>;
}) => Promise<unknown>;

/** The app's redis-backed epoch bump (src/server/authz/epoch.ts). */
export type AuthzEpochBumper = (args: {
  organizationId: string;
}) => Promise<void>;

export type GrantPrincipal =
  | { type: "user"; id: string }
  | { type: "group"; id: string }
  | { type: "apiKey"; id: string };

export type GrantRole =
  | { builtin: "ADMIN" | "MEMBER" | "VIEWER" }
  | { customRoleId: string };

type Actor = { userId: string };

/**
 * The app-owned effect seams, composed once in the app's runtime
 * (platform/app/src/server/authz/runtime.ts): the EE audit writer, the
 * KSUID minter for binding ids, the redis-backed epoch bump, and the
 * collector factory the offboarding proof re-binds to its transaction
 * (injected rather than constructed so this module keeps no value import of
 * the collector).
 */
export type GrantsServiceDeps = {
  audit: AuthzAuditWriter;
  newBindingId: () => string;
  bumpEpoch: AuthzEpochBumper;
  collectorFor: (reader: AuthzReadRepository) => AuthzCollectorService;
};

export class GrantsService {
  constructor(
    private readonly repository: AuthzGrantsRepository,
    private readonly deps: GrantsServiceDeps,
  ) {}

  /** INSERT (who, role, where) — visible on the next check. */
  async attach({
    actor,
    who,
    role,
    where,
  }: {
    actor: Actor;
    who: GrantPrincipal;
    role: GrantRole;
    where: AuthzScopeRef;
  }): Promise<{ bindingId: string }> {
    if (where.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION, {
        kind: where.kind,
        resourceId: where.id,
      });
    }
    const organizationId = scopeOrganizationId(where);
    const { repository } = this;
    await assertScopeBelongsToOrganization({
      repository,
      where,
      organizationId,
    });
    await assertRoleUsable({ repository, role, organizationId });

    const row = this.bindingRow({ who, role, where, organizationId });
    try {
      await repository.createBinding(row);
    } catch (error) {
      rethrowKnownWriteFailure(error, {
        scopeType: where.type,
        scopeId: where.id,
      });
    }

    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.attach",
      metadata: { bindingId: row.bindingId, who, role, scope: where },
    });
    return { bindingId: row.bindingId };
  }

  /** UPDATE the row's role — visible on the next check. */
  async update({
    actor,
    bindingId,
    organizationId,
    role,
  }: {
    actor: Actor;
    bindingId: string;
    organizationId: string;
    role: GrantRole;
  }): Promise<void> {
    const { repository } = this;
    await assertBindingInOrganization({
      repository,
      bindingId,
      organizationId,
    });
    await assertRoleUsable({ repository, role, organizationId });
    try {
      await repository.updateBindingRole({
        bindingId,
        role: "customRoleId" in role ? "CUSTOM" : role.builtin,
        customRoleId: "customRoleId" in role ? role.customRoleId : null,
      });
    } catch (error) {
      // A role change can collide with a sibling binding the principal
      // already holds at the same scope - same knowable failure as attach.
      rethrowKnownWriteFailure(error, { bindingId });
    }
    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.update",
      metadata: { bindingId, role },
    });
  }

  /** DELETE the row — access gone on the next check. */
  async revoke({
    actor,
    bindingId,
    organizationId,
  }: {
    actor: Actor;
    bindingId: string;
    organizationId: string;
  }): Promise<void> {
    const { repository } = this;
    await assertBindingInOrganization({
      repository,
      bindingId,
      organizationId,
    });
    try {
      await repository.deleteBinding({ bindingId });
    } catch (error) {
      rethrowKnownWriteFailure(error, { bindingId });
    }
    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.revoke",
      metadata: { bindingId },
    });
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
  }: {
    actor: Actor;
    who: GrantPrincipal;
    from: AuthzScopeRef;
    to: AuthzScopeRef;
    role: GrantRole;
  }): Promise<{ bindingId: string }> {
    if (from.type === "resource" || to.type === "resource") {
      throw new GrantValidationError(RESOURCE_SCOPE_REJECTION);
    }
    const organizationId = scopeOrganizationId(from);
    if (scopeOrganizationId(to) !== organizationId) {
      throw new GrantValidationError(
        "replace() must stay within one organization",
      );
    }
    const { repository } = this;
    await assertScopeBelongsToOrganization({
      repository,
      where: to,
      organizationId,
    });
    await assertRoleUsable({ repository, role, organizationId });
    const row = this.bindingRow({ who, role, where: to, organizationId });
    try {
      await repository.replaceBinding({
        deleteWhere: {
          organizationId,
          scopeType: SCOPE_TYPE_FOR_REF[from.type],
          scopeId: from.id,
          principal: principalWhere(who),
        },
        create: row,
      });
    } catch (error) {
      rethrowKnownWriteFailure(error, {
        scopeType: to.type,
        scopeId: to.id,
      });
    }
    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.replace",
      metadata: { who, from, to, role, bindingId: row.bindingId },
    });
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
  }: {
    actor: Actor;
    userId: string;
    organizationId: string;
  }): Promise<{
    removed: OffboardCounts;
    needsHumanDecision: {
      ownedApiKeys: Array<{ id: string; name: string }>;
      personalTeams: Array<{ id: string; name: string }>;
    };
  }> {
    const result = await offboardUserFromOrganization({
      repository: this.repository,
      collectorFor: this.deps.collectorFor,
      userId,
      organizationId,
    });

    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.offboard",
      metadata: {
        offboardedUserId: userId,
        removed: result.removed,
        ownedApiKeyIds: result.needsHumanDecision.ownedApiKeys.map(
          (key) => key.id,
        ),
        personalTeamIds: result.needsHumanDecision.personalTeams.map(
          (team) => team.id,
        ),
      },
    });

    return result;
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
      bindingId: this.deps.newBindingId(),
      organizationId,
      scopeType: SCOPE_TYPE_FOR_REF[where.type],
      scopeId: where.id,
      role: "customRoleId" in role ? "CUSTOM" : role.builtin,
      customRoleId: "customRoleId" in role ? role.customRoleId : null,
      principal: principalWhere(who),
    };
  }

  /**
   * Epoch first, audit second, and deliberately not one unit of work. The
   * bump is what makes the write VISIBLE to the next check; a failed audit
   * must never leave a committed grant change sitting behind a stale cache,
   * so the audit error propagates only after the bump has happened.
   */
  private async recordAndBump({
    actor,
    organizationId,
    action,
    metadata,
  }: {
    actor: Actor;
    organizationId: string;
    action: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.deps.bumpEpoch({ organizationId });
    await this.deps.audit({
      userId: actor.userId,
      organizationId,
      action,
      metadata,
    });
  }
}
