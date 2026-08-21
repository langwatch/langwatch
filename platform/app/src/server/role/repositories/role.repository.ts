import type { LedgerActor } from "@langwatch/actor";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  type CustomRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { CutoverAwareAccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.cutover.repository";
import type { AccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.repository";
import { isRootPrismaClient } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { RoleDuplicateNameError, RoleNotFoundError } from "../errors";
import { CUSTOM_ROLE_KIND } from "../role-kind";

export type RolePrismaDelegate = PrismaClient | Prisma.TransactionClient;

/**
 * Derives create params from Prisma schema, omitting auto-generated fields
 */
export type CreateRoleParams = Omit<
  Prisma.CustomRoleUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * Derives update params from Prisma schema for selective field updates
 */
export type UpdateRoleParams = Partial<
  Pick<CustomRole, "name" | "description" | "permissions">
>;

/**
 * Repository for custom role data access
 * Single Responsibility: Handle all database operations for CustomRole
 */
export class RoleRepository {
  constructor(
    private readonly prisma: RolePrismaDelegate,
    /**
     * Role definitions and the grants that carry them are ledger facts
     * (ADR-092 §13). The writer never rides the caller's transaction — it
     * appends to ClickHouse and folds through the queue — so it is composed
     * over the app's own client rather than `prisma` above, which may be a
     * transaction client.
     */
    private readonly writer: GrantsLedgerWriter = grantsLedgerWriter(),
    // Listing reads go through the per-organization fork (ADR-092,
    // delivery-plan PR 3 follow-up): a cut-over organization's role editor
    // lists from the ledger's own Role head.
    private readonly accessListing: AccessListingRepository = new CutoverAwareAccessListingRepository(
      prisma,
    ),
  ) {}

  async findAllByOrganization(organizationId: string) {
    return this.prisma.customRole.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findUserCreatedByOrganization(organizationId: string) {
    // Through the per-organization fork (ADR-092, delivery-plan PR 3
    // follow-up): a cut-over organization's role editor is served from the
    // ledger's own Role head.
    return this.accessListing.findUserCreatedRoles({ organizationId });
  }

  async findById(roleId: string) {
    return this.prisma.customRole.findUnique({
      where: { id: roleId },
    });
  }

  async findByIdInOrg(roleId: string, organizationId: string) {
    return this.prisma.customRole.findUnique({
      where: { id: roleId, organizationId },
      select: { id: true, permissions: true },
    });
  }

  async findAssignableByIds(roleIds: string[], organizationId: string) {
    return this.prisma.customRole.findMany({
      where: {
        id: { in: roleIds },
        organizationId,
        kind: CUSTOM_ROLE_KIND.CUSTOM,
      },
      select: { id: true },
    });
  }

  /**
   * The permission lists of these user-created roles, for callers that have to
   * inspect what a role grants before a binding to it is written.
   */
  async findAssignablePermissionsByIds(
    roleIds: string[],
    organizationId: string,
  ) {
    return this.prisma.customRole.findMany({
      where: {
        id: { in: roleIds },
        organizationId,
        kind: CUSTOM_ROLE_KIND.CUSTOM,
      },
      select: { id: true, permissions: true },
    });
  }

  async findByIdWithUsers(roleId: string) {
    return this.prisma.customRole.findUnique({
      where: { id: roleId },
      include: { assignedUsers: true },
    });
  }

  /**
   * A user-created role by id, only when it belongs to the organization.
   * The org-scoped service paths use this so a foreign role id reads as
   * not found rather than leaking another organization's role.
   */
  async findCustomByIdInOrg({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }) {
    return this.prisma.customRole.findFirst({
      where: { id: roleId, organizationId, kind: CUSTOM_ROLE_KIND.CUSTOM },
    });
  }

  async findByIdWithUsersInOrg({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }) {
    return this.prisma.customRole.findFirst({
      where: { id: roleId, organizationId },
      include: { assignedUsers: true },
    });
  }

  /**
   * The role bindings in this organization that reference this role.
   *
   * Organization-scoped because the tenancy middleware requires it of every
   * `RoleBinding` query. `deleteIfUnused` asks a wider question in raw SQL, so
   * a count of zero here does not mean the delete will go through; see
   * `RoleService.deleteRoleRow`, which settles that by re-reading the role.
   */
  async countRoleBindings({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }): Promise<number> {
    return this.prisma.roleBinding.count({
      where: { customRoleId: roleId, organizationId },
    });
  }

  /** The legacy `TeamUser.assignedRoleId` holders of a role. */
  async countAssignedUsers(roleId: string): Promise<number> {
    return this.prisma.teamUser.count({ where: { assignedRoleId: roleId } });
  }

  /**
   * Deletes the role only if nothing references it, and reports whether it
   * went.
   *
   * The reference check is a read taken immediately before the delete is
   * emitted, not a condition riding on the delete itself: the role is a
   * ledger fact (ADR-092 §13) and its deletion is a command, so the check
   * cannot be part of the write. What that costs is one race: a binding
   * created between the read and the append is silently
   * unhooked from the role that grants it, because the relation is emulated
   * in the client (`relationMode = "prisma"`), so deleting the parent nulls
   * the reference instead of refusing. What survives is the guarantee callers
   * actually rely on — a role somebody holds at the moment of the check is
   * left standing, and the caller is told so rather than finding it gone.
   *
   * The role row is scoped to the organization; the reference checks are not.
   * There are no database foreign keys here, so a binding in another
   * organization can point at this role, and an organization-scoped check
   * would delete the role out from under it and leave a dangling reference
   * that silently resolves to the built-in permission bag.
   */
  async deleteIfUnused({
    roleId,
    organizationId,
    actor,
  }: {
    roleId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<boolean> {
    // Raw SQL on purpose: the reference check spans every organization (a
    // binding in another org can point at this role, see the doc block), and
    // the tenancy guard rightly refuses a cross-org `roleBinding.count` on
    // the model client.
    const [role, holderRows, assignedUsers] = await Promise.all([
      this.prisma.customRole.findFirst({
        where: { id: roleId, organizationId },
        select: { id: true },
      }),
      this.prisma.$queryRaw<
        { count: bigint }[]
      >`-- @tenancy: the delete refuses while ANY organization's binding still references the role (relationMode = "prisma" has no FK to refuse for us)
        SELECT COUNT(*) AS count FROM "RoleBinding" WHERE "customRoleId" = ${roleId}`,
      this.prisma.teamUser.count({ where: { assignedRoleId: roleId } }),
    ]);
    const holders = Number(holderRows[0]?.count ?? 0n);
    if (!role || holders > 0 || assignedUsers > 0) return false;

    await this.writer.deleteRole({ organizationId, roleId, actor });
    return true;
  }

  async findByNameAndOrganization(name: string, organizationId: string) {
    return this.prisma.customRole.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name,
        },
      },
    });
  }

  /**
   * Define a role. `role_defined` carries the whole fact, so this is the same
   * verb behind a create and an edit, and the fold upserts the projection row.
   *
   * The id is minted here because the ledger, not the database, writes the
   * row - `nanoid()` is exactly the default the column carried, so ids keep
   * their shape. The returned value IS the emitted fact rather than a row
   * read back: the fact is durable the moment the append lands, and the row
   * follows through the fold.
   */
  async create({
    params,
    actor,
  }: {
    params: CreateRoleParams;
    actor: LedgerActor;
  }): Promise<CustomRole> {
    const roleId = nanoid();
    await this.assertNameFree({
      organizationId: params.organizationId,
      name: params.name,
      exceptRoleId: null,
    });
    const kind = params.kind ?? CUSTOM_ROLE_KIND.CUSTOM;
    await this.writer.defineRole({
      organizationId: params.organizationId,
      roleId,
      name: params.name,
      // Present-or-absent, not truthy-or-absent: an empty description is a
      // description the caller wrote, and the column stores it.
      ...(params.description != null
        ? { description: params.description }
        : {}),
      permissions: params.permissions as string[],
      kind: kind as "custom" | "system_api_key",
      actor,
    });
    const now = new Date();
    return {
      id: roleId,
      organizationId: params.organizationId,
      name: params.name,
      description: params.description ?? null,
      permissions: params.permissions as Prisma.JsonValue,
      kind,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Redefine a role. The event carries the whole fact, so the fields the
   * caller left out are read off the current definition and re-stated.
   */
  async update({
    roleId,
    params,
    actor,
  }: {
    roleId: string;
    params: UpdateRoleParams;
    actor: LedgerActor;
  }): Promise<CustomRole> {
    const existing = await this.prisma.customRole.findUnique({
      where: { id: roleId },
    });
    if (!existing) {
      // Knowable and actionable: the role was deleted between the caller
      // opening the editor and saving it, and there is nothing to redefine.
      // A plain Error degraded this to an "unknown error" with a trace id.
      throw new RoleNotFoundError(roleId);
    }
    const name = params.name ?? existing.name;
    const description =
      params.description !== undefined
        ? params.description
        : existing.description;
    const permissions = (params.permissions ??
      existing.permissions) as string[];

    if (name !== existing.name) {
      await this.assertNameFree({
        organizationId: existing.organizationId,
        name,
        exceptRoleId: roleId,
      });
    }

    await this.writer.defineRole({
      organizationId: existing.organizationId,
      roleId,
      name,
      // `!== null` rather than a truthy test: an empty description is the
      // caller clearing it, and a falsy check dropped that from the fact, so
      // the fold re-stated the description the role already had.
      ...(description !== null ? { description } : {}),
      permissions,
      kind: existing.kind as "custom" | "system_api_key",
      actor,
    });
    return {
      ...existing,
      name,
      description,
      permissions: permissions as Prisma.JsonValue,
      updatedAt: new Date(),
    };
  }

  /**
   * The `(organizationId, name)` natural key, checked immediately before the
   * append: the ledger writes the row through the fold, where a collision
   * would stall the organization rather than refuse the caller, so the read
   * has to be the gate rather than a unique-index constraint failure. Two
   * renames to one name inside the same instant is the residual race, and
   * it is the same one the pre-check above always had.
   */
  private async assertNameFree({
    organizationId,
    name,
    exceptRoleId,
  }: {
    organizationId: string;
    name: string;
    exceptRoleId: string | null;
  }): Promise<void> {
    const collision = await this.prisma.customRole.findUnique({
      where: { organizationId_name: { organizationId, name } },
      select: { id: true },
    });
    if (collision && collision.id !== exceptRoleId) {
      throw new RoleDuplicateNameError();
    }
  }

  async isExclusiveToApiKey({
    roleId,
    apiKeyId,
  }: {
    roleId: string;
    apiKeyId: string;
  }): Promise<boolean> {
    const role = await this.prisma.customRole.findFirst({
      where: {
        id: roleId,
        roleBindings: { every: { apiKeyId } },
        assignedUsers: { none: {} },
      },
      select: { id: true },
    });
    return role !== null;
  }

  async deleteExclusiveToApiKey({
    roleIds,
    apiKeyId,
    organizationId,
    actor,
    awaitProjection = true,
  }: {
    roleIds: string[];
    apiKeyId: string;
    organizationId: string;
    actor: LedgerActor;
    /** Same contract as `GrantsLedgerWriter.deleteRole`'s parameter of this name. */
    awaitProjection?: boolean;
  }) {
    if (roleIds.length === 0) return;
    // Revoke this api key's CUSTOM grants on these roles FIRST. The
    // customRoleId FK is ON DELETE SET NULL, but the
    // RoleBinding_custom_role_check constraint forbids a CUSTOM binding with a
    // null customRoleId, so deleting the role while its binding still exists
    // throws. Once the grant is gone the role can be deleted cleanly (and an
    // exclusive role is left with zero bindings). Grants of a revoked key are
    // void anyway — the key row survives (revokedAt) as the audit record.
    // Shared roles (grants from other keys remain) fail the exclusivity check
    // below and are correctly kept.
    await this.writer.revokeBindingsWhere({
      organizationId,
      where: { apiKeyId, customRoleId: { in: roleIds } },
      actor,
      reason: "api key credential retired",
    });

    for (const roleId of roleIds) {
      const [holders, assignedUsers] = await Promise.all([
        // organizationId is load-bearing: the tenancy guard refuses a
        // RoleBinding query whose only api-key predicate is `{ not: ... }`,
        // and a system_api_key role's bindings live in its own organization.
        this.prisma.roleBinding.count({
          where: {
            organizationId,
            customRoleId: roleId,
            apiKeyId: { not: apiKeyId },
          },
        }),
        this.prisma.teamUser.count({ where: { assignedRoleId: roleId } }),
      ]);
      if (holders > 0 || assignedUsers > 0) continue;
      await this.writer.deleteRole({
        organizationId,
        roleId,
        actor,
        awaitProjection,
      });
    }
  }

  async findTeamById(teamId: string) {
    return this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
  }

  async findUserTeamBinding({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }) {
    return this.prisma.roleBinding.findFirst({
      where: {
        userId,
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });
  }

  async findTeamMembersWithUsers({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId: string;
  }) {
    return this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        userId: { not: null },
      },
      include: { user: true },
    });
  }

  async findUserCustomRoleBinding({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }) {
    return this.prisma.roleBinding.findFirst({
      where: {
        userId,
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        customRoleId: { not: null },
      },
      select: { customRoleId: true },
    });
  }

  private requireFullClient(): PrismaClient {
    if (!isRootPrismaClient(this.prisma)) {
      throw new Error(
        "assignToUser/removeFromUser require PrismaClient, not a TransactionClient",
      );
    }
    return this.prisma;
  }

  async assignToUser({
    userId,
    teamId,
    customRoleId,
    actor,
  }: {
    userId: string;
    teamId: string;
    customRoleId: string;
    actor: LedgerActor;
  }) {
    await this.replaceTeamGrant({
      userId,
      teamId,
      role: TeamUserRole.CUSTOM,
      customRoleId,
      actor,
    });
  }

  async removeFromUser({
    userId,
    teamId,
    actor,
  }: {
    userId: string;
    teamId: string;
    actor: LedgerActor;
  }) {
    await this.replaceTeamGrant({
      userId,
      teamId,
      role: TeamUserRole.VIEWER,
      customRoleId: null,
      actor,
    });
  }

  /**
   * Point this member at exactly one role on the team: revoke whatever they
   * hold there, then attach the one the caller asked for. Revoke first, so a
   * crash between the two leaves less access than asked for and the retry
   * converges - the transaction this replaced offered atomicity, and the
   * ledger offers a fail-safe order instead.
   */
  private async replaceTeamGrant({
    userId,
    teamId,
    role,
    customRoleId,
    actor,
  }: {
    userId: string;
    teamId: string;
    role: TeamUserRole;
    customRoleId: string | null;
    actor: LedgerActor;
  }) {
    const prisma = this.requireFullClient();
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { organizationId: true },
    });

    await this.writer.revokeBindingsWhere({
      organizationId: team.organizationId,
      where: {
        userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
      actor,
      reason: "team role replaced",
    });
    await this.writer.attachBindings({
      organizationId: team.organizationId,
      bindings: [
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId },
          role,
          customRoleId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
      ],
      actor,
      onDuplicate: "skip",
    });
  }
}
