/**
 * ADR-092 §11 (setting) + §10 (offboarding) — the one write surface for
 * grants. Every mutation validates against the registry/tenancy, emits an
 * audit event, and bumps the org's authz epoch so caches and passports die
 * on the caller's next request. Storage is behind AuthzGrantsRepository -
 * the Prisma implementation (and its transactions) lives in the app; this
 * service owns validation, naming failures, and the offboarding proof.
 *
 * Migration note (stage D0): the eight legacy RoleBinding write paths
 * (member add, invites, SCIM, groups, API keys, project creation, role
 * editor, better-auth hooks) route through this service as they migrate;
 * new code starts here.
 */
import { type AuthzScopeRef, scopeOrganizationId } from "@langwatch/authz";
import { HandledError } from "@langwatch/handled-error";
import { AuthzCollectorService } from "./authz-collector.service";
import {
  type AuthzGrantsRepository,
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type RoleBindingWrite,
} from "./authz-grants.repository";

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

export class GrantValidationError extends HandledError {
  constructor(message: string, meta: Record<string, unknown> = {}) {
    super("grant_validation_failed", message, { httpStatus: 400, meta });
    this.name = "GrantValidationError";
  }
}

export class OffboardIncompleteError extends HandledError {
  constructor(meta: Record<string, unknown> = {}) {
    super(
      "offboard_incomplete",
      "Offboarding left resolvable grants behind; transaction rolled back",
      // fault: the proof failing means OUR deletes missed a grant source -
      // a platform defect, never something the admin did wrong.
      { httpStatus: 500, fault: "platform", meta },
    );
    this.name = "OffboardIncompleteError";
  }
}

export type GrantPrincipal =
  | { type: "user"; id: string }
  | { type: "group"; id: string }
  | { type: "apiKey"; id: string };

export type GrantRole =
  | { builtin: "ADMIN" | "MEMBER" | "VIEWER" }
  | { customRoleId: string };

type Actor = { userId: string };

const SCOPE_TYPE_FOR_REF = {
  project: "PROJECT",
  team: "TEAM",
  organization: "ORGANIZATION",
} as const;

type GrantableScope = Exclude<AuthzScopeRef, { type: "resource" }>;

/**
 * The app-owned effect seams, composed once in the app's runtime
 * (platform/app/src/server/authz/runtime.ts): the EE audit writer, the
 * KSUID minter for binding ids, and the redis-backed epoch bump.
 */
export type GrantsServiceDeps = {
  audit: AuthzAuditWriter;
  newBindingId: () => string;
  bumpEpoch: AuthzEpochBumper;
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
      throw new GrantValidationError(
        "Resource-tier access is granted by sharing the resource, not by a role binding (ResourceGrant storage lands in stage C5)",
        { kind: where.kind, resourceId: where.id },
      );
    }
    const organizationId = scopeOrganizationId(where);
    await this.assertScopeBelongsToOrganization({ where, organizationId });
    if ("customRoleId" in role) {
      await this.assertCustomRoleInOrganization({
        customRoleId: role.customRoleId,
        organizationId,
      });
    }

    const row = this.bindingRow({ who, role, where, organizationId });
    try {
      await this.repository.createBinding(row);
    } catch (error) {
      this.throwIfDuplicateBinding(error, {
        scopeType: where.type,
        scopeId: where.id,
      });
      throw error;
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
    role,
  }: {
    actor: Actor;
    bindingId: string;
    role: GrantRole;
  }): Promise<void> {
    const binding = await this.requireBinding(bindingId);
    if ("customRoleId" in role) {
      await this.assertCustomRoleInOrganization({
        customRoleId: role.customRoleId,
        organizationId: binding.organizationId,
      });
    }
    try {
      await this.repository.updateBindingRole({
        bindingId,
        role: "customRoleId" in role ? "CUSTOM" : role.builtin,
        customRoleId: "customRoleId" in role ? role.customRoleId : null,
      });
    } catch (error) {
      // A role change can collide with a sibling binding the principal
      // already holds at the same scope - same knowable failure as attach.
      this.throwIfDuplicateBinding(error, { bindingId });
      throw error;
    }
    await this.recordAndBump({
      actor,
      organizationId: binding.organizationId,
      action: "authz.grants.update",
      metadata: { bindingId, role },
    });
  }

  /** DELETE the row — access gone on the next check. */
  async revoke({
    actor,
    bindingId,
  }: {
    actor: Actor;
    bindingId: string;
  }): Promise<void> {
    const binding = await this.requireBinding(bindingId);
    await this.repository.deleteBinding({ bindingId });
    await this.recordAndBump({
      actor,
      organizationId: binding.organizationId,
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
      throw new GrantValidationError(
        "Resource-tier access is granted by sharing the resource, not by a role binding (ResourceGrant storage lands in stage C5)",
      );
    }
    const organizationId = scopeOrganizationId(from);
    if (scopeOrganizationId(to) !== organizationId) {
      throw new GrantValidationError(
        "replace() must stay within one organization",
      );
    }
    await this.assertScopeBelongsToOrganization({
      where: to,
      organizationId,
    });
    if ("customRoleId" in role) {
      await this.assertCustomRoleInOrganization({
        customRoleId: role.customRoleId,
        organizationId,
      });
    }
    const row = this.bindingRow({ who, role, where: to, organizationId });
    try {
      await this.repository.replaceBinding({
        deleteWhere: {
          organizationId,
          scopeType: SCOPE_TYPE_FOR_REF[from.type],
          scopeId: from.id,
          principal: principalWhere(who),
        },
        create: row,
      });
    } catch (error) {
      this.throwIfDuplicateBinding(error, {
        scopeType: to.type,
        scopeId: to.id,
      });
      throw error;
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
   * ADR-092 §10 — offboarding, one transaction with a postcondition. The
   * repository deletes every grant source for the user and calls back with
   * a transaction-bound reader; re-collecting through it proves the
   * effective set resolves to nothing INSIDE the transaction (anything left
   * rolls the whole thing back). Returns the manifest of what still needs
   * a human decision.
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
    removed: {
      bindings: number;
      groupMemberships: number;
      legacyTeamMemberships: number;
      pendingInvites: number;
      organizationMembership: boolean;
    };
    needsHumanDecision: {
      ownedApiKeys: Array<{ id: string; name: string }>;
      personalTeams: Array<{ id: string; name: string }>;
    };
  }> {
    const email = await this.repository.findUserEmail({ userId });

    const removed = await this.repository.offboardUser({
      userId,
      organizationId,
      email,
      // The proof (§10 step 7): re-collect against the transaction — the
      // deletes are visible there — and fail loudly if anything still
      // resolves. Group- or key-held grants cannot survive for this user:
      // memberships are gone and personal keys are ceilinged by an owner
      // who now resolves to nothing.
      prove: async (txReader) => {
        const grants = await new AuthzCollectorService(txReader).collectGrants({
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
      },
    });

    const [ownedApiKeys, personalTeams] = await Promise.all([
      this.repository.findOwnedApiKeys({ userId, organizationId }),
      this.repository.findPersonalTeams({ userId, organizationId }),
    ]);

    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.offboard",
      metadata: {
        offboardedUserId: userId,
        removed,
        ownedApiKeyIds: ownedApiKeys.map((key) => key.id),
        personalTeamIds: personalTeams.map((team) => team.id),
      },
    });

    return { removed, needsHumanDecision: { ownedApiKeys, personalTeams } };
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
      userId: who.type === "user" ? who.id : null,
      groupId: who.type === "group" ? who.id : null,
      apiKeyId: who.type === "apiKey" ? who.id : null,
    };
  }

  /**
   * The partial unique indexes on RoleBinding make a duplicate a knowable
   * failure the caller can act on - the repository surfaces it as
   * DuplicateBindingError, and it is named here instead of degrading to
   * "unknown error". The indexes key on the role too, so this only fires
   * when the principal already holds this SAME role (or custom role) at
   * the scope.
   */
  private throwIfDuplicateBinding(
    error: unknown,
    meta: Record<string, unknown>,
  ): void {
    if (error instanceof DuplicateBindingError) {
      throw new GrantValidationError(
        "This principal already holds this role at this scope - update or revoke the existing binding",
        meta,
      );
    }
  }

  private async requireBinding(bindingId: string) {
    const binding = await this.repository.findBinding({ bindingId });
    if (!binding) {
      throw new GrantValidationError("Role binding not found", { bindingId });
    }
    return binding;
  }

  private async assertScopeBelongsToOrganization({
    where,
    organizationId,
  }: {
    where: GrantableScope;
    organizationId: string;
  }): Promise<void> {
    if (where.type === "organization") return;
    if (where.type === "team") {
      const team = await this.repository.findTeamOrganization({
        teamId: where.id,
      });
      if (team?.organizationId !== organizationId) {
        throw new GrantValidationError("Team is not in this organization", {
          teamId: where.id,
        });
      }
      return;
    }
    const lineage = await this.repository.findProjectLineage({
      projectId: where.id,
    });
    if (
      lineage?.organizationId !== organizationId ||
      lineage.teamId !== where.teamId
    ) {
      throw new GrantValidationError("Project is not in this scope", {
        projectId: where.id,
      });
    }
  }

  private async assertCustomRoleInOrganization({
    customRoleId,
    organizationId,
  }: {
    customRoleId: string;
    organizationId: string;
  }): Promise<void> {
    const customRole = await this.repository.findCustomRoleOrganization({
      customRoleId,
    });
    if (!customRole || customRole.organizationId !== organizationId) {
      throw new GrantValidationError(
        "Custom role does not belong to this organization",
        { customRoleId },
      );
    }
  }

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
    await this.deps.audit({
      userId: actor.userId,
      organizationId,
      action,
      metadata,
    });
    await this.deps.bumpEpoch({ organizationId });
  }
}

function principalWhere(who: GrantPrincipal): BindingPrincipalWhere {
  switch (who.type) {
    case "user":
      return { userId: who.id };
    case "group":
      return { groupId: who.id };
    case "apiKey":
      return { apiKeyId: who.id };
  }
}
