/**
 * ADR-092 §11 (setting) + §10 (offboarding) — the one write surface for
 * grants. Every mutation validates against the registry/tenancy, emits an
 * audit event, and bumps the org's authz epoch so caches and passports die
 * on the caller's next request.
 *
 * Migration note (stage D0): the eight legacy RoleBinding write paths
 * (member add, invites, SCIM, groups, API keys, project creation, role
 * editor, better-auth hooks) route through this service as they migrate;
 * new code starts here.
 */

import { auditLog } from "@ee/audit-log/auditLog";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient, TeamUserRole } from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { collectGrants } from "./collector";
import type { AuthzScopeRef } from "./engine";
import { scopeOrganizationId } from "./engine";
import { bumpAuthzEpoch } from "./epoch";

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
      { httpStatus: 500, meta },
    );
    this.name = "OffboardIncompleteError";
  }
}

export type GrantPrincipal =
  | { type: "user"; id: string }
  | { type: "group"; id: string }
  | { type: "apiKey"; id: string };

export type GrantRole =
  | { builtin: Exclude<TeamUserRole, "CUSTOM"> }
  | { customRoleId: string };

type Actor = { userId: string };

const SCOPE_TYPE_FOR_REF = {
  project: "PROJECT",
  team: "TEAM",
  organization: "ORGANIZATION",
} as const;

export class GrantsService {
  constructor(private readonly prisma: PrismaClient) {}

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
      const customRole = await this.prisma.customRole.findUnique({
        where: { id: role.customRoleId },
        select: { organizationId: true },
      });
      if (!customRole || customRole.organizationId !== organizationId) {
        throw new GrantValidationError(
          "Custom role does not belong to this organization",
          { customRoleId: role.customRoleId },
        );
      }
    }

    const bindingId = generate(KSUID_RESOURCES.ROLE_BINDING).toString();
    await this.prisma.roleBinding.create({
      data: {
        id: bindingId,
        organizationId,
        scopeType: SCOPE_TYPE_FOR_REF[where.type],
        scopeId: where.id,
        role: "customRoleId" in role ? "CUSTOM" : role.builtin,
        customRoleId: "customRoleId" in role ? role.customRoleId : null,
        userId: who.type === "user" ? who.id : null,
        groupId: who.type === "group" ? who.id : null,
        apiKeyId: who.type === "apiKey" ? who.id : null,
      },
    });

    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.attach",
      metadata: { bindingId, who, role, scope: where },
    });
    return { bindingId };
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
    await this.prisma.roleBinding.update({
      where: { id: bindingId },
      data: {
        role: "customRoleId" in role ? "CUSTOM" : role.builtin,
        customRoleId: "customRoleId" in role ? role.customRoleId : null,
      },
    });
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
    await this.prisma.roleBinding.delete({ where: { id: bindingId } });
    await this.recordAndBump({
      actor,
      organizationId: binding.organizationId,
      action: "authz.grants.revoke",
      metadata: { bindingId },
    });
  }

  /**
   * The REDUCE verb (ADR-092 §3): atomically replace a broad grant with a
   * narrower one — never a second binding fighting the first.
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
    await this.prisma.roleBinding.deleteMany({
      where: {
        organizationId,
        scopeType: SCOPE_TYPE_FOR_REF[from.type],
        scopeId: from.id,
        ...principalWhere(who),
      },
    });
    const attached = await this.attach({ actor, who, role, where: to });
    await this.recordAndBump({
      actor,
      organizationId,
      action: "authz.grants.replace",
      metadata: { who, from, to, role, bindingId: attached.bindingId },
    });
    return attached;
  }

  /**
   * ADR-092 §10 — offboarding, one transaction with a postcondition. Deletes
   * every grant source for the user in the organization, proves the
   * effective set resolves to nothing INSIDE the transaction (anything left
   * rolls the whole thing back), and returns the manifest of what needs a
   * human decision.
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const removed = await this.prisma.$transaction(async (tx) => {
      const bindings = await tx.roleBinding.deleteMany({
        where: { organizationId, userId },
      });
      const groupMemberships = await tx.groupMembership.deleteMany({
        where: { userId, group: { organizationId } },
      });
      const legacyTeamMemberships = await tx.teamUser.deleteMany({
        where: { userId, team: { organizationId } },
      });
      const organizationMembership = await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
      });
      const pendingInvites = user?.email
        ? await tx.organizationInvite.deleteMany({
            where: { organizationId, email: user.email, status: "PENDING" },
          })
        : { count: 0 };

      // The proof (§10 step 7): re-collect inside the transaction — the
      // deletes are visible here — and fail loudly if anything still
      // resolves. Group- or key-held grants cannot survive for this user:
      // memberships are gone and personal keys are ceilinged by an owner
      // who now resolves to nothing.
      const grants = await collectGrants({
        prisma: tx as PrismaClient,
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

      return {
        bindings: bindings.count,
        groupMemberships: groupMemberships.count,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    });

    const [ownedApiKeys, personalTeams] = await Promise.all([
      this.prisma.apiKey.findMany({
        where: { userId, organizationId, revokedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.team.findMany({
        where: { organizationId, isPersonal: true, ownerUserId: userId },
        select: { id: true, name: true },
      }),
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

  private async requireBinding(bindingId: string) {
    const binding = await this.prisma.roleBinding.findUnique({
      where: { id: bindingId },
      select: { id: true, organizationId: true },
    });
    if (!binding) {
      throw new GrantValidationError("Role binding not found", { bindingId });
    }
    return binding;
  }

  private async assertScopeBelongsToOrganization({
    where,
    organizationId,
  }: {
    where: AuthzScopeRef;
    organizationId: string;
  }): Promise<void> {
    if (where.type === "organization") return;
    if (where.type === "team") {
      const team = await this.prisma.team.findUnique({
        where: { id: where.id },
        select: { organizationId: true },
      });
      if (team?.organizationId !== organizationId) {
        throw new GrantValidationError("Team is not in this organization", {
          teamId: where.id,
        });
      }
      return;
    }
    const project = await this.prisma.project.findUnique({
      where: { id: where.id },
      select: { team: { select: { id: true, organizationId: true } } },
    });
    if (
      project?.team?.organizationId !== organizationId ||
      project.team.id !== where.teamId
    ) {
      throw new GrantValidationError("Project is not in this scope", {
        projectId: where.id,
      });
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
    await auditLog({
      userId: actor.userId,
      organizationId,
      action,
      metadata: metadata as Prisma.JsonObject,
    });
    await bumpAuthzEpoch({ organizationId });
  }
}

function principalWhere(who: GrantPrincipal) {
  switch (who.type) {
    case "user":
      return { userId: who.id };
    case "group":
      return { groupId: who.id };
    case "apiKey":
      return { apiKeyId: who.id };
  }
}
