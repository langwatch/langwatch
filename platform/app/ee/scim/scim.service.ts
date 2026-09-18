// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DepartmentService } from "@ee/governance/services/department/department.service";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { GrantsService } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

import {
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  type ScimUserResource,
  TeamUserRole,
  type User,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { GrantsAccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.grants.repository";
import { grantsService } from "~/server/app-layer/authz/runtime";
import { lockActiveAdmins } from "~/server/app-layer/organizations/active-admin-lock";
import {
  CannotDisableLastAdminError,
  CannotRemoveLastAdminError,
} from "~/server/app-layer/organizations/errors";
import { UserService } from "~/server/users/user.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
  type ScimError,
  type ScimListResponse,
  type ScimPatchOperation,
  type ScimPatchRequest,
  type ScimUser,
} from "./scim.types";
import { ScimDeprovisionService } from "./scim-deprovision.service";
import { ScimDirectoryIdentityService } from "./scim-directory-identity.service";
import { parseScimFilter, type ScimFilterTerm } from "./scim-filter";
import {
  reconcileScimGrants,
  retireScimMembershipGrants,
} from "./scim-grants.reconciler";
import { scimGrantsWritePathEnabled } from "./scim-grants-flag";
import { mergeNameParts, namePartsIn } from "./scim-name";
import { assertScimOrganizationId } from "./scim-organization-scope";
import { resolveHighestRole } from "./scim-role-resolver";
import { scimSyncLifecycle } from "./scim-sync.runtime";
import type { ScimSyncLifecycle } from "./scim-sync.service";
import { ScimUserResourceRepository } from "./scim-user-resource.prisma.repository";

/**
 * Maps SCIM resources using organization-owned profiles and shared account ids.
 *
 * Every operation is scoped to an ORGANIZATION for multitenancy and, since
 * D08, to the CONNECTION whose token authenticated the push: the person a
 * push means is `(connectionId, externalId)`, and a push may not touch
 * somebody another connection provisioned. `connectionId` is nullable only
 * for the tokens that predate connection scoping, which keep the
 * organization-wide authority they were sold with.
 *
 * See specs/identity/scim-connection-sync.feature.
 */
export class ScimService {
  readonly #accessListing: GrantsAccessListingRepository;
  private readonly prisma: PrismaClient;
  private readonly writer: GrantsLedgerWriter;
  private readonly userService: UserService;
  private readonly departmentService: DepartmentService;
  private readonly directoryIdentity: ScimDirectoryIdentityService;
  readonly #resources: ScimUserResourceRepository;
  private readonly injected: {
    grants?: GrantsService;
    syncLifecycle?: ScimSyncLifecycle;
  };

  constructor({
    prisma,
    writer = grantsLedgerWriter(),
    grants,
    syncLifecycle,
  }: {
    prisma: PrismaClient;
    writer?: GrantsLedgerWriter;
    grants?: GrantsService;
    syncLifecycle?: ScimSyncLifecycle;
  }) {
    this.#accessListing = new GrantsAccessListingRepository(prisma);
    this.prisma = prisma;
    this.writer = writer;
    this.userService = UserService.create(prisma);
    this.departmentService = DepartmentService.create(prisma);
    this.directoryIdentity = ScimDirectoryIdentityService.create(prisma);
    this.#resources = ScimUserResourceRepository.create(prisma);
    this.injected = { grants, syncLifecycle };
  }

  /**
   * The grants write surface and the sync history are composed on FIRST USE,
   * not in the constructor: both reach the app's runtime, and a SCIM route
   * builds this service on every request — including the read-only ones, which
   * need neither. A test hands its own in and never touches the runtime.
   */
  private get grants(): GrantsService {
    return this.injected.grants ?? grantsService();
  }

  private get syncLifecycle(): ScimSyncLifecycle {
    return this.injected.syncLifecycle ?? scimSyncLifecycle(this.prisma);
  }

  private get deprovision(): ScimDeprovisionService {
    return new ScimDeprovisionService({
      grants: this.grants,
      syncLifecycle: this.syncLifecycle,
    });
  }

  /**
   * The directory acts as itself, not as whoever happens to hold the SCIM
   * token — and it stays this ONE principal however many connections an
   * organization has. An earlier note here said the id becomes the
   * connection id once identity connections exist; that was wrong and D08
   * dropped it. `SYSTEM_ACTORS` is a closed registry of named principals
   * (see its own comment forbidding call sites inventing `system:...`
   * strings) and a connection id is a per-customer value, so it can never be
   * a member of it. Which connection pushed a change belongs on the SCIM
   * event, which already carries `connectionId`. Cross-organization safety
   * comes from the token's connection scope at the API boundary, never from
   * this stamp. See specs/identity/scim-connection-sync.feature.
   */
  private static readonly ACTOR = {
    type: "system",
    id: SYSTEM_ACTORS.scim,
  } as const;

  /** Retire duplicate directory grants; the previous rollout path still writes MEMBER. */
  private async reconcileOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    if (scimGrantsWritePathEnabled()) {
      await retireScimMembershipGrants({
        prisma: this.prisma,
        writer: this.writer,
        organizationId,
        userIds: [userId],
        actor: ScimService.ACTOR,
      });
      return;
    }

    const role = await this.directoryAssertedRole({ userId, organizationId });
    await reconcileScimGrants({
      prisma: this.prisma,
      writer: this.writer,
      organizationId,
      where: {
        principal: { type: "user", id: userId },
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
      desired:
        role === null
          ? []
          : [
              {
                principal: { userId },
                role,
                customRoleId: null,
                scopeType: RoleBindingScopeType.ORGANIZATION,
                scopeId: organizationId,
              },
            ],
      actor: ScimService.ACTOR,
      mintBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    });
  }

  /**
   * The role the directory asserts for this person at the organization, or
   * null when it asserts none.
   *
   * A directory does not push roles; it pushes group membership, and an
   * administrator maps a group to a role at a scope. So what the directory
   * asserts is the highest role among the organization-scoped mappings the
   * person's groups carry — `resolveHighestRole`'s hierarchy, the same one
   * the group-mapping surface uses.
   *
   * `CUSTOM` resolves to null on purpose: a custom role is a specific
   * `customRoleId`, and "the highest of several custom roles" is not a
   * question the hierarchy can answer. The group's own binding already grants
   * it; there is nothing for a second organization-scoped binding to add.
   */
  private async directoryAssertedRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<TeamUserRole | null> {
    if (!scimGrantsWritePathEnabled()) {
      // The previous write path, unchanged: an unconditional MEMBER. Kept
      // whole rather than approximated, because rollback has to mean the old
      // behaviour and not a near-miss of it.
      return TeamUserRole.MEMBER;
    }
    const memberships = await this.prisma.groupMembership.findMany({
      where: {
        userId,
        group: { organizationId, scimSource: { not: null } },
      },
      select: { groupId: true },
    });
    const groupIds = memberships.map(({ groupId }) => groupId);
    if (groupIds.length === 0) return null;

    const mapped = await this.#accessListing.findUserAndGroupBindings({
      organizationId,
      userId,
      groupIds,
    });
    const roles = mapped
      .filter(
        (binding) =>
          binding.groupId !== null &&
          binding.group !== null &&
          binding.group.scimSource !== null &&
          binding.scopeType === RoleBindingScopeType.ORGANIZATION &&
          binding.scopeId === organizationId,
      )
      .map((binding) => binding.role);
    if (roles.length === 0) return null;
    const resolved = resolveHighestRole(roles);
    return resolved === TeamUserRole.CUSTOM ? null : resolved;
  }

  /**
   * The organization role the membership ROW carries, derived from the same
   * assertion rather than fixed. `OrganizationUserRole` is a coarser
   * vocabulary than the grant's — the engine reads it for the EXTERNAL cap —
   * so an asserted ADMIN maps to ADMIN and everything else, asserted or not,
   * to MEMBER: a person the directory has provisioned IS a member, whatever
   * role it has or has not mapped for them.
   */
  private organizationRoleFor(role: TeamUserRole | null): OrganizationUserRole {
    return role === TeamUserRole.ADMIN ? "ADMIN" : "MEMBER";
  }

  static create(options: {
    prisma: PrismaClient;
    writer?: GrantsLedgerWriter;
    grants?: GrantsService;
    syncLifecycle?: ScimSyncLifecycle;
  }): ScimService {
    return new ScimService(options);
  }

  /**
   * Apply the SCIM enterprise costCenter attribute to a membership. A
   * non-empty name resolves (creating if absent) and assigns; an explicit
   * empty/null value clears the assignment so spend rolls up under
   * Unassigned. `undefined` means the attribute was not in this request, so
   * the current assignment is left untouched.
   */
  private async syncCostCenterFromScim({
    userId,
    organizationId,
    costCenter,
  }: {
    userId: string;
    organizationId: string;
    costCenter: string | null | undefined;
  }): Promise<void> {
    if (costCenter === undefined) return;

    const trimmed = typeof costCenter === "string" ? costCenter.trim() : "";
    if (trimmed === "") {
      await this.departmentService.assignUser({
        organizationId,
        userId,
        departmentId: null,
      });
      return;
    }

    const department = await this.departmentService.resolveByNameOrCreate({
      organizationId,
      name: trimmed,
    });
    await this.departmentService.assignUser({
      organizationId,
      userId,
      departmentId: department.id,
    });
  }

  /**
   * Read the enterprise costCenter from a create/replace body. Returns
   * `undefined` when the enterprise extension is absent so callers can tell
   * "not provided" from "explicitly cleared".
   */
  private costCenterFromRequest(
    request: ScimCreateUserRequest,
  ): string | null | undefined {
    const ext = (request as Record<string, unknown>)[
      SCIM_ENTERPRISE_USER_SCHEMA
    ] as { costCenter?: string | null } | undefined;
    if (!ext || !("costCenter" in ext)) return undefined;
    return ext.costCenter ?? null;
  }

  /**
   * Read the enterprise costCenter from a PATCH operation, supporting both
   * the schema-qualified path form (`...:User:costCenter`) and the
   * value-object form. Returns `{ present: false }` when the op does not
   * touch costCenter.
   */
  private costCenterFromPatchOp(
    operation: ScimPatchOperation,
  ): { present: true; value: string | null } | { present: false } {
    const costCenterPath = `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter`;

    if (operation.path === costCenterPath) {
      if (operation.op === "remove") return { present: true, value: null };
      const v = operation.value;
      return { present: true, value: typeof v === "string" ? v : null };
    }

    if (operation.value != null && typeof operation.value === "object") {
      const value = operation.value as Record<string, unknown>;
      const ext = value[SCIM_ENTERPRISE_USER_SCHEMA] as
        | { costCenter?: string | null }
        | undefined;
      if (ext && "costCenter" in ext) {
        return { present: true, value: ext.costCenter ?? null };
      }
    }

    return { present: false };
  }

  async createUser({
    request,
    organizationId,
    connectionId = null,
  }: {
    request: ScimCreateUserRequest;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimUser | ScimError> {
    assertScimOrganizationId(organizationId);
    const externalId = request.externalId ?? null;
    const existingUser = await this.resolveUser({
      organizationId,
      connectionId,
      externalId,
      email: request.userName,
    });
    if (existingUser) {
      await this.directoryIdentity.assertWritable({
        organizationId,
        connectionId,
        userId: existingUser.id,
      });
      const membership = await this.prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId: existingUser.id, organizationId },
        },
      });
      const previous = await this.#resources.find(
        organizationId,
        existingUser.id,
      );
      if (membership && !previous?.deletedAt) {
        return this.scimError({
          status: "409",
          detail: "User already exists in this organization",
        });
      }
    }

    const conflict = await this.userNameConflict(
      organizationId,
      existingUser?.id,
      request.userName,
    );
    if (conflict) return conflict;

    // Initial account creation is the only SCIM write to global account state.
    const user =
      existingUser ??
      (await this.userService.create({
        name: this.buildNameFromRequest(request),
        email: request.userName,
      }));
    const active = request.active !== false;
    if (active) {
      try {
        await this.createMembership({ userId: user.id, organizationId });
      } catch (error) {
        if (
          !(
            error instanceof PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
        )
          throw error;
        // A retried create still repairs the grant beside an existing membership.
      }
      await this.reconcileOrganizationMembership({
        userId: user.id,
        organizationId,
      });
      await this.syncCostCenterFromScim({
        userId: user.id,
        organizationId,
        costCenter: this.costCenterFromRequest(request),
      });
    }
    const resource = await this.saveResource({
      organizationId,
      userId: user.id,
      userName: request.userName,
      name: this.buildNameFromRequest(request),
      active,
    });
    if ("status" in resource) return resource;
    await this.recordPush({
      organizationId,
      connectionId,
      userId: user.id,
      externalId,
      op: "create",
    });
    return this.toScimUser(user, resource);
  }

  private async userNameConflict(
    organizationId: string,
    userId: string | undefined,
    userName: string,
  ): Promise<ScimError | null> {
    const holder = await this.#resources.findUserByName(
      organizationId,
      userName,
    );
    const conflicting =
      (holder !== null && holder.id !== userId) ||
      (await this.#resources.hasLegacyNameConflict(
        organizationId,
        userId,
        userName,
      ));
    return conflicting
      ? this.scimError({
          status: "409",
          scimType: "uniqueness",
          detail: "User name already exists in this organization",
        })
      : null;
  }

  private async saveResource(input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
    active: boolean;
  }): Promise<ScimUserResource | ScimError> {
    try {
      return await this.#resources.save(input);
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return this.scimError({
          status: "409",
          scimType: "uniqueness",
          detail: "User name already exists in this organization",
        });
      }
      throw error;
    }
  }

  /** Directory aliases resolve only inside this organization's SCIM API, never as sign-in proof. */
  private async resolveUser({
    organizationId,
    connectionId,
    externalId,
    email,
  }: {
    organizationId: string;
    connectionId: string | null;
    externalId: string | null;
    email: string;
  }): Promise<User | null> {
    if (connectionId && externalId) {
      const mappedId = await this.directoryIdentity.getUserId({
        connectionId,
        externalId,
      });
      if (mappedId) {
        const mapped = await this.userService.findById({ id: mappedId });
        if (mapped) return mapped;
      }
    }
    return (
      (await this.#resources.findUserByName(organizationId, email)) ??
      (await this.userService.findByEmail({ email }))
    );
  }

  private async findOrganizationUser(organizationId: string, id: string) {
    const [resource, membership] = await Promise.all([
      this.#resources.find(organizationId, id),
      this.prisma.organizationUser.findUnique({
        where: { userId_organizationId: { userId: id, organizationId } },
      }),
    ]);
    if (resource?.deletedAt || (!resource && !membership)) return null;
    const user = await this.userService.findById({ id });
    return user ? { user, resource, hasMembership: membership !== null } : null;
  }

  /**
   * The membership row, with the role the directory asserts rather than a
   * fixed `MEMBER`.
   *
   * It is still a row, and it still has to be: the authorization engine reads
   * `OrganizationUser` for whether somebody is a member at all and for the
   * EXTERNAL cap. What D08 changes is that nothing writes it with a role
   * nothing asserted, and that the grant beside it is reconciled from the
   * same assertion in the same call.
   */
  private async createMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const asserted = await this.directoryAssertedRole({
      userId,
      organizationId,
    });
    await this.prisma.organizationUser.create({
      data: {
        userId,
        organizationId,
        role: this.organizationRoleFor(asserted),
      },
    });
  }

  /**
   * Record a successful push and its ownership. DELETE logs the removal
   * without reclaiming the ownership it just forgot.
   *
   * Both are no-ops for a token that predates connection scoping: there is no
   * connection to attribute the push to, and no pair to key an identity on.
   */
  private async recordPush({
    organizationId,
    connectionId,
    userId,
    externalId,
    op,
  }: {
    organizationId: string;
    connectionId: string | null;
    userId: string;
    externalId: string | null;
    op: "create" | "update" | "deactivate" | "delete";
  }): Promise<void> {
    if (!connectionId) return;
    if (op !== "delete") {
      await this.directoryIdentity.remember({
        organizationId,
        connectionId,
        externalId,
        userId,
      });
    }
    await this.syncLifecycle.userPushed({
      organizationId,
      connectionId,
      userId,
      // The aggregate keys a person by the directory's identifier, and a
      // provider that sends none leaves us only ours. Recording the user id
      // in its place keeps the fact about a person rather than about nobody.
      externalId: externalId ?? userId,
      op: op === "delete" ? "deactivate" : op,
    });
  }

  async getUser({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<ScimUser | ScimError> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);
    return found
      ? this.toScimUser(found.user, found.resource)
      : this.scimError({ status: "404", detail: "User not found" });
  }

  /**
   * Who this organization holds, one page at a time.
   *
   * Three things here are load-bearing only once the directory is bigger than
   * one page, which is why all three were wrong until a five-thousand-person
   * simulator read them back (specs/identity/scim-directory-reads.feature):
   *
   * - THE ORDER IS FIXED. A page is `skip`/`take` over a result set, and
   *   Postgres promises no order without being asked for one. Fifty pages
   *   over five thousand people are fifty separate queries, so an unordered
   *   scan hands the same person to two pages and never hands over somebody
   *   else at all. `User.id` is unique within the result, so it settles
   *   the order completely rather than merely mostly.
   * - THE PAGE SAYS WHAT IT HOLDS. `itemsPerPage` is the size of THIS page
   *   (RFC 7644 §3.4.2.4), not the size that was asked for. Reporting the
   *   request meant the last page of every directory claimed to be full, and
   *   a provider advancing by what we reported stepped past the tail.
   * - A FILTER IS HONOURED OR REFUSED. Never dropped — see `scim-filter.ts`.
   */
  async listUsers({
    organizationId,
    connectionId = null,
    filter,
    startIndex = 1,
    count = 100,
  }: {
    organizationId: string;
    /** Whose directory identifiers an `externalId` filter resolves against.
     *  A filter on one connection's identifier must never find another
     *  connection's person, and the pair is the key that keeps them apart. */
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser> | ScimError> {
    assertScimOrganizationId(organizationId);
    const parsed = parseScimFilter({
      filter,
      supported: ["userName", "externalId"],
    });
    if (!parsed.ok) {
      return this.scimError({
        status: "400",
        scimType: "invalidFilter",
        detail: parsed.detail,
      });
    }

    const whereClause = await this.userListWhere({
      organizationId,
      connectionId,
      term: parsed.term,
    });

    const [users, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        include: { scimUserResources: { where: { organizationId } } },
        skip: startIndex - 1,
        take: count,
        orderBy: { id: "asc" },
      }),
      this.prisma.user.count({ where: whereClause }),
    ]);

    const resources = users.map((user) =>
      this.toScimUser(user, user.scimUserResources[0]),
    );
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /**
   * The `where` one listing runs under.
   *
   * An `externalId` term resolves through the connection's own mapping and
   * narrows to that one person. A term naming an identifier this connection
   * does not know narrows to NOBODY rather than widening back to everybody:
   * `id: { in: [] }` is an empty page, which is the honest answer to
   * "who do you have under this identifier" when the answer is nobody.
   */
  private async userListWhere({
    organizationId,
    connectionId,
    term,
  }: {
    organizationId: string;
    connectionId: string | null;
    term: ScimFilterTerm | null;
  }): Promise<Prisma.UserWhereInput> {
    const whereClause: Prisma.UserWhereInput = {
      scimUserResources: { none: { organizationId, deletedAt: { not: null } } },
      OR: [
        { orgMemberships: { some: { organizationId } } },
        { scimUserResources: { some: { organizationId } } },
      ],
    };
    if (!term) return whereClause;

    if (term.attribute === "userName") {
      whereClause.AND = [
        {
          OR: [
            {
              scimUserResources: {
                some: {
                  organizationId,
                  userName: { equals: term.value, mode: "insensitive" },
                },
              },
            },
            {
              scimUserResources: { none: { organizationId } },
              email: { equals: term.value, mode: "insensitive" },
            },
          ],
        },
      ];
      return whereClause;
    }

    const mapped = connectionId
      ? await this.prisma.scimExternalId.findUnique({
          where: {
            connectionId_externalId: {
              connectionId,
              externalId: term.value,
            },
          },
          select: { userId: true },
        })
      : null;
    whereClause.id = { in: mapped ? [mapped.userId] : [] };
    return whereClause;
  }

  async replaceUser({
    id,
    organizationId,
    request,
    connectionId = null,
  }: {
    id: string;
    organizationId: string;
    request: ScimCreateUserRequest;
    connectionId?: string | null;
  }): Promise<ScimUser | ScimError> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);
    if (!found)
      return this.scimError({ status: "404", detail: "User not found" });
    await this.directoryIdentity.assertWritable({
      organizationId,
      connectionId,
      userId: id,
    });
    const conflict = await this.userNameConflict(
      organizationId,
      id,
      request.userName,
    );
    if (conflict) return conflict;
    const active = request.active !== false;
    if (!active && found.hasMembership) {
      await this.deactivate({ id, organizationId, connectionId });
    }
    if (active && found.hasMembership) {
      await this.syncCostCenterFromScim({
        userId: id,
        organizationId,
        costCenter: this.costCenterFromRequest(request),
      });
    }
    const resource = await this.saveResource({
      organizationId,
      userId: id,
      userName: request.userName,
      name: this.buildNameFromRequest(request),
      active,
    });
    if ("status" in resource) return resource;
    await this.recordPush({
      organizationId,
      connectionId,
      userId: id,
      externalId: request.externalId ?? null,
      op: active ? "update" : "deactivate",
    });
    return this.toScimUser(found.user, resource);
  }

  /** Revoke tenant grants before removing membership, regardless of rollout path. */
  private async revokeOnThePreviousWritePath({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    await this.writer.revokeBindingsWhere({
      organizationId,
      where: { userId },
      actor: ScimService.ACTOR,
      reason: "offboarded by the identity provider",
    });
  }

  private async assertPreviousPathKeepsActiveAdmin({
    tx,
    userId,
    organizationId,
    error,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    organizationId: string;
    error: CannotDisableLastAdminError | CannotRemoveLastAdminError;
  }): Promise<void> {
    const member = await tx.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, disabledAt: true },
    });
    if (member?.role !== OrganizationUserRole.ADMIN || member.disabledAt) {
      return;
    }
    const activeAdmins = await lockActiveAdmins({ tx, organizationId });
    if (
      activeAdmins.some((admin) => admin.userId === userId) &&
      activeAdmins.length <= 1
    ) {
      throw error;
    }
  }

  private async deactivateOnPreviousWritePath({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertPreviousPathKeepsActiveAdmin({
        tx,
        userId,
        organizationId,
        error: new CannotDisableLastAdminError(),
      });
      await this.revokeOnThePreviousWritePath({ userId, organizationId });
      await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
      });
    });
  }

  private async deleteOnPreviousWritePath({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertPreviousPathKeepsActiveAdmin({
        tx,
        userId,
        organizationId,
        error: new CannotRemoveLastAdminError(),
      });
      await this.revokeOnThePreviousWritePath({ userId, organizationId });
      await tx.organizationUser.delete({
        where: { userId_organizationId: { userId, organizationId } },
      });
    });
  }

  /** Access removal must succeed before the directory resource is marked inactive. */
  private async deactivate({
    id,
    organizationId,
    connectionId,
  }: {
    id: string;
    organizationId: string;
    connectionId: string | null;
  }): Promise<void> {
    if (scimGrantsWritePathEnabled()) {
      await this.deprovision.removeAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "deactivate_user",
      });
    } else {
      await this.deactivateOnPreviousWritePath({
        userId: id,
        organizationId,
      });
    }
  }

  /**
   * What a PATCH operation says about `active`, across the two spellings
   * identity providers use — a scalar at `path: "active"` (Okta, Entra) and
   * an `active` key inside a value object. `undefined` means the operation
   * says nothing about it.
   */
  private activeInPatchOp(operation: ScimPatchOperation): boolean | undefined {
    if (operation.op !== "replace") return undefined;
    if (operation.path === "active") {
      return !(operation.value === false || operation.value === "false");
    }
    if (operation.value != null && typeof operation.value === "object") {
      const value = operation.value as Record<string, unknown>;
      if ("active" in value) return value.active !== false;
    }
    return undefined;
  }

  private userNameInPatchOp(operation: ScimPatchOperation): string | undefined {
    if (operation.path === "userName" && typeof operation.value === "string") {
      return operation.value;
    }
    if (operation.value === null || typeof operation.value !== "object") {
      return undefined;
    }

    const userName = (operation.value as Record<string, unknown>).userName;
    return typeof userName === "string" ? userName : undefined;
  }

  private patchValues({
    operations,
    active,
    name,
    userName,
  }: {
    operations: ScimPatchOperation[];
    active: boolean;
    name: string | null;
    userName: string;
  }): {
    active: boolean;
    deactivating: boolean;
    name: string | null;
    userName: string;
    costCenters: (string | null)[];
  } {
    let deactivating = false;
    const costCenters: (string | null)[] = [];

    for (const operation of operations) {
      const costCenter = this.costCenterFromPatchOp(operation);
      if (costCenter.present) {
        costCenters.push(costCenter.value);
      }
      if (operation.op !== "replace") continue;

      const nextActive = this.activeInPatchOp(operation);
      if (nextActive !== undefined) {
        deactivating ||= !nextActive;
        active = nextActive;
      }

      const nameParts = namePartsIn({
        path: operation.path,
        value: operation.value,
      });
      if (nameParts) {
        name = mergeNameParts({ current: name, ...nameParts }) ?? name;
      }

      const nextUserName = this.userNameInPatchOp(operation);
      if (nextUserName !== undefined) {
        userName = nextUserName;
      }
    }

    return { active, deactivating, name, userName, costCenters };
  }

  async updateUser({
    id,
    organizationId,
    patchRequest,
    connectionId = null,
  }: {
    id: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
    connectionId?: string | null;
  }): Promise<ScimUser | ScimError> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);
    if (!found)
      return this.scimError({ status: "404", detail: "User not found" });
    await this.directoryIdentity.assertWritable({
      organizationId,
      connectionId,
      userId: id,
    });

    const { active, deactivating, name, userName, costCenters } =
      this.patchValues({
        operations: patchRequest.Operations,
        active: found.resource?.active ?? found.user.deactivatedAt === null,
        name: found.resource ? found.resource.name : found.user.name,
        userName: found.resource?.userName ?? found.user.email ?? "",
      });
    const conflict = await this.userNameConflict(organizationId, id, userName);
    if (conflict) return conflict;
    if (deactivating && found.hasMembership) {
      await this.deactivate({ id, organizationId, connectionId });
    } else if (found.hasMembership) {
      for (const costCenter of costCenters) {
        await this.syncCostCenterFromScim({
          userId: id,
          organizationId,
          costCenter,
        });
      }
    }
    const op = deactivating ? "deactivate" : "update";
    const resource = await this.saveResource({
      organizationId,
      userId: id,
      userName,
      name,
      active,
    });
    if ("status" in resource) return resource;
    await this.recordPush({
      organizationId,
      connectionId,
      userId: id,
      externalId: null,
      op,
    });
    return this.toScimUser(found.user, resource);
  }

  async deleteUser({
    id,
    organizationId,
    connectionId = null,
  }: {
    id: string;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimError | null> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);
    if (!found)
      return this.scimError({ status: "404", detail: "User not found" });
    await this.directoryIdentity.assertWritable({
      organizationId,
      connectionId,
      userId: id,
    });
    if (found.hasMembership) {
      if (scimGrantsWritePathEnabled()) {
        await this.deprovision.removeAccess({
          userId: id,
          organizationId,
          connectionId,
          op: "delete_user",
        });
      } else {
        await this.deleteOnPreviousWritePath({ userId: id, organizationId });
      }
    }
    await this.#resources.markDeleted({
      organizationId,
      userId: id,
      userName: found.resource?.userName ?? found.user.email ?? "",
      name: found.resource ? found.resource.name : found.user.name,
    });
    const where = {
      organizationId,
      userId: id,
      ...(connectionId === null ? {} : { connectionId }),
    };
    await this.prisma.$transaction([
      this.prisma.scimExternalId.deleteMany({ where }),
      this.prisma.scimDirectoryUser.deleteMany({ where }),
    ]);
    await this.recordPush({
      organizationId,
      connectionId,
      userId: id,
      externalId: null,
      op: "delete",
    });
    return null;
  }

  toScimUser(user: User, resource?: ScimUserResource | null): ScimUser {
    const { givenName, familyName } = this.splitName(
      (resource ? resource.name : user.name) ?? "",
    );
    const userName = resource?.userName ?? user.email ?? "";

    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      userName,
      name: {
        givenName,
        familyName,
      },
      emails: [
        {
          primary: true,
          value: userName,
          type: "work",
        },
      ],
      active: resource?.active ?? user.deactivatedAt === null,
      meta: {
        resourceType: "User",
        created: (resource?.createdAt ?? user.createdAt).toISOString(),
        lastModified: (resource?.updatedAt ?? user.updatedAt).toISOString(),
      },
    };
  }

  private buildNameFromRequest(request: ScimCreateUserRequest): string {
    if (request.name) {
      const parts = [request.name.givenName, request.name.familyName].filter(
        Boolean,
      );
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }
    return request.userName.split("@")[0] ?? request.userName;
  }

  private splitName(fullName: string): {
    givenName: string;
    familyName: string;
  } {
    const spaceIndex = fullName.indexOf(" ");
    if (spaceIndex === -1) {
      return { givenName: fullName, familyName: "" };
    }
    return {
      givenName: fullName.substring(0, spaceIndex),
      familyName: fullName.substring(spaceIndex + 1),
    };
  }

  private scimError({
    status,
    detail,
    scimType,
  }: {
    status: string;
    detail: string;
    scimType?: string;
  }): ScimError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
      ...(scimType ? { scimType } : {}),
    };
  }
}
