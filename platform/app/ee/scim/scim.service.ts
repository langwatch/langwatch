// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DepartmentService } from "@ee/governance/services/department/department.service";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { GrantsService } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
  type User,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { grantsService } from "~/server/app-layer/authz/runtime";
import { CannotDisableLastAdminError } from "~/server/app-layer/organizations/errors";
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
import { reconcileScimGrants } from "./scim-grants.reconciler";
import { scimGrantsWritePathEnabled } from "./scim-grants-flag";
import { mergeNameParts, namePartsIn } from "./scim-name";
import { resolveHighestRole } from "./scim-role-resolver";
import { scimSyncLifecycle } from "./scim-sync.runtime";
import type { ScimSyncLifecycle } from "./scim-sync.service";

/**
 * Maps between SCIM 2.0 User resources and LangWatch User/OrganizationUser models.
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
  private readonly prisma: PrismaClient;
  private readonly writer: GrantsLedgerWriter;
  private readonly userService: UserService;
  private readonly departmentService: DepartmentService;
  private readonly directoryIdentity: ScimDirectoryIdentityService;
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
    this.prisma = prisma;
    this.writer = writer;
    this.userService = UserService.create(prisma);
    this.departmentService = DepartmentService.create(prisma);
    this.directoryIdentity = ScimDirectoryIdentityService.create(prisma);
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

  /**
   * The organization-scoped membership grant a directory push asserts,
   * reconciled rather than written: re-pushing the same state emits nothing.
   *
   * WHAT ROLE, since D08. This used to desire `MEMBER` unconditionally — a
   * fixed role written beside the grant, asserted by nothing. Now the desired
   * set is what the directory's own mapping says: the highest role the
   * person's mapped groups carry, and NOTHING when the directory has mapped
   * nothing for them yet. A person the directory has not given a role is
   * still a member of the organization — that is the `OrganizationUser` row —
   * they simply hold no organization-scoped role binding until a mapping
   * asserts one.
   */
  private async reconcileOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const role = await this.directoryAssertedRole({ userId, organizationId });
    await reconcileScimGrants({
      prisma: this.prisma,
      writer: this.writer,
      organizationId,
      where: {
        userId,
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
    const mapped = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
        group: { members: { some: { userId } }, scimSource: { not: null } },
      },
      select: { role: true },
    });
    if (mapped.length === 0) return null;
    const resolved = resolveHighestRole(mapped.map((row) => row.role));
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
    const email = request.userName;
    const name = this.buildNameFromRequest(request);
    const externalId = request.externalId ?? null;

    // The directory's own identifier comes first, and the address second.
    // A person whose email changed between two pushes is the same person, and
    // resolving on the address would create a second account for them.
    const existingUser = await this.resolveUser({
      connectionId,
      externalId,
      email,
    });

    if (existingUser) {
      await this.directoryIdentity.assertWritable({
        connectionId,
        userId: existingUser.id,
      });
      const existingMembership = await this.prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId: existingUser.id,
            organizationId,
          },
        },
      });

      if (existingMembership) {
        return this.scimError({
          status: "409",
          detail: "User already exists in this organization",
        });
      }

      try {
        await this.createMembership({
          userId: existingUser.id,
          organizationId,
        });
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
          // The membership already exists (lost a race, or a retried push),
          // but its grant may not: reconcile so a SCIM retry still repairs a
          // membership left without its grant.
          await this.reconcileOrganizationMembership({
            userId: existingUser.id,
            organizationId,
          });
          await this.recordPush({
            organizationId,
            connectionId,
            userId: existingUser.id,
            externalId,
            op: "create",
          });
          return this.toScimUser(existingUser);
        }
        throw e;
      }

      await this.reconcileOrganizationMembership({
        userId: existingUser.id,
        organizationId,
      });

      if (existingUser.deactivatedAt) {
        await this.userService.reactivate({ id: existingUser.id });
      }

      await this.syncCostCenterFromScim({
        userId: existingUser.id,
        organizationId,
        costCenter: this.costCenterFromRequest(request),
      });

      await this.recordPush({
        organizationId,
        connectionId,
        userId: existingUser.id,
        externalId,
        op: "create",
      });

      const reloadedUser = await this.userService.findById({
        id: existingUser.id,
      });
      if (!reloadedUser) {
        return this.scimError({ status: "404", detail: "User not found" });
      }
      return this.toScimUser(reloadedUser);
    }

    const newUser = await this.userService.create({ name, email });

    try {
      await this.createMembership({ userId: newUser.id, organizationId });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
        return this.scimError({
          status: "409",
          detail: "User already exists in this organization",
        });
      }
      throw e;
    }

    await this.reconcileOrganizationMembership({
      userId: newUser.id,
      organizationId,
    });

    await this.syncCostCenterFromScim({
      userId: newUser.id,
      organizationId,
      costCenter: this.costCenterFromRequest(request),
    });

    await this.recordPush({
      organizationId,
      connectionId,
      userId: newUser.id,
      externalId,
      op: "create",
    });

    return this.toScimUser(newUser);
  }

  /**
   * Who this push is about.
   *
   * The connection's own identifier for the person first, because it is what
   * survives their address changing; the address only as the fallback for a
   * push that carries no `externalId` (the protocol allows it, and plenty of
   * providers omit it on update). A person no connection knows resolves to
   * whoever holds that address, which is what lets a directory adopt a member
   * an administrator invited by hand.
   */
  private async resolveUser({
    connectionId,
    externalId,
    email,
  }: {
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
    return this.userService.findByEmail({ email });
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
   * State on the connection's sync that this push happened, and remember who
   * the directory means by this identifier.
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
    op: "create" | "update" | "deactivate";
  }): Promise<void> {
    if (!connectionId) return;
    if (externalId) {
      await this.directoryIdentity.remember({
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
      op,
    });
  }

  async getUser({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<ScimUser | ScimError> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: id,
          organizationId,
        },
      },
      include: { user: true },
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    return this.toScimUser(membership.user);
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
   *   else at all. `userId` is unique within an organization, so it settles
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

    const [memberships, totalCount] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: whereClause,
        include: { user: true },
        skip: startIndex - 1,
        take: count,
        orderBy: { userId: "asc" },
      }),
      this.prisma.organizationUser.count({ where: whereClause }),
    ]);

    const resources = memberships.map((m) => this.toScimUser(m.user));
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
   * `userId: { in: [] }` is an empty page, which is the honest answer to
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
  }): Promise<Record<string, unknown>> {
    const whereClause: Record<string, unknown> = { organizationId };
    if (!term) return whereClause;

    if (term.attribute === "userName") {
      whereClause.user = {
        email: { equals: term.value, mode: "insensitive" },
      };
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
    whereClause.userId = { in: mapped ? [mapped.userId] : [] };
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
    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: id,
          organizationId,
        },
      },
    });

    if (!membership) {
      const returning = await this.reinstateSignIn({
        id,
        connectionId,
        active: request.active !== false,
      });
      return (
        returning ?? this.scimError({ status: "404", detail: "User not found" })
      );
    }

    await this.directoryIdentity.assertWritable({ connectionId, userId: id });

    const name = this.buildNameFromRequest(request);
    const active = request.active !== false;

    const updatedUser = await this.userService.updateProfile({
      id,
      name,
      email: request.userName,
    });

    if (active && updatedUser.deactivatedAt) {
      await this.reactivate({ id });
    } else if (!active && !updatedUser.deactivatedAt) {
      await this.deactivate({ id, organizationId, connectionId });
    }

    await this.syncCostCenterFromScim({
      userId: id,
      organizationId,
      costCenter: this.costCenterFromRequest(request),
    });

    await this.recordPush({
      organizationId,
      connectionId,
      userId: id,
      externalId: request.externalId ?? null,
      op: active ? "update" : "deactivate",
    });

    const reloadedUser = await this.userService.findById({ id });
    if (!reloadedUser) {
      return this.scimError({ status: "404", detail: "User not found" });
    }
    return this.toScimUser(reloadedUser);
  }

  /**
   * The previous write path's revocation, which BOTH removals share.
   *
   * `SCIM_V2_GRANTS` chooses who writes membership, and that is all it
   * chooses: whether a leaver keeps their access is not a thing a rollback
   * lever gets a vote on. It had one anyway, because this branch existed for
   * a deletion and was never written for a deactivation - so on the shipped
   * default a directory pushing `active: false` set `deactivatedAt` and left
   * the membership row, the role grant and the seat exactly where they were,
   * and the change list, which reads revoked grants, recorded nothing at all.
   * A leaver was invisible on the audit surface on the path real directories
   * actually use, which `deleteUser` never was.
   *
   * The grants go first and carry instant enforcement (ADR-092 decision 7),
   * so the deny holds before the push returns rather than whenever the queue
   * next drains. `offboardMember`'s fold sweeps every grant the principal
   * holds, not only the ones this read could see, so a grant appended moments
   * before the push is still revoked once the fold catches up. The id list is
   * the audit record and today's synchronous enforcement, not the
   * instruction.
   */
  private async revokeOnThePreviousWritePath({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const visibleGrants = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      select: { id: true },
    });
    await this.writer.offboardMember({
      organizationId,
      userId,
      revokedGrantIds: visibleGrants.map((row) => row.id),
      actor: ScimService.ACTOR,
    });
  }

  /**
   * Marking somebody inactive is a DEPROVISION, not a flag (D08).
   *
   * Until D08 this set `deactivatedAt` and revoked nothing. Deactivation does
   * block sign-in and API-key verification, so what stood behind the flag was
   * latent authority rather than an open door — but latent authority comes
   * back without a decision: reactivating somebody restored every permission
   * they held on the day they left, with nobody choosing that. So the access
   * goes, with the same proof a deletion carries, and coming back is re-entry
   * rather than undo.
   *
   * The order matters. The access goes FIRST, and only a proved-empty removal
   * is allowed to reach the flag: a failure here leaves the person exactly as
   * they were and refuses the push, rather than marking them inactive while
   * they still hold access — which is the one outcome that would report the
   * directory's requested state as reached when it was not.
   */
  private async deactivate({
    id,
    organizationId,
    connectionId,
  }: {
    id: string;
    organizationId: string;
    connectionId: string | null;
  }): Promise<void> {
    await this.refuseIfItClosesTheOrganization({ userId: id, organizationId });
    if (scimGrantsWritePathEnabled()) {
      await this.deprovision.removeAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "deactivate_user",
      });
    } else {
      await this.revokeOnThePreviousWritePath({ userId: id, organizationId });
    }
    await this.userService.deactivate({ id });
  }

  /**
   * A directory may not deactivate the last administrator who can still sign
   * in.
   *
   * THE ORGANIZATION CANNOT RECOVER FROM THIS FROM INSIDE THE PRODUCT, which
   * is the same reason `setMemberDisabled` refuses it by hand
   * (`organization.prisma.repository.ts`, `CannotDisableLastAdminError`). The
   * SCIM path reached the same outcome around the side: a full sync asserts
   * the set of people the directory knows about and deactivates the rest, and
   * an administrator invited by hand is in nobody's directory. Observed: a
   * first sync reported "1 created and 4 deactivated" and one of the four was
   * the organization's only administrator, whose live session died mid-page
   * and whose password was then refused. Getting back in took a hand-written
   * SCIM call, and there is no screen that makes one.
   *
   * ADOPTION IS NOT THE BUG AND IS LEFT ALONE. A token reaching a person no
   * connection has claimed is deliberate — `ScimDirectoryIdentityService`
   * says so, and it is what lets a directory take over members who predate
   * it. What is refused here is narrower and is about the organization rather
   * than about the person: the act that would leave nobody able to administer
   * it.
   *
   * ACTIVE MEANS ABLE TO SIGN IN, so the count excludes a member whose user
   * is already deactivated as well as one whose membership is disabled. The
   * membership-only definition would let a single push deactivate two
   * administrators one after another, each passing the guard because the
   * other's `disabledAt` had not been written.
   */
  private async refuseIfItClosesTheOrganization({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const member = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    // Not an administrator here, or not a member at all: nothing this act can
    // close.
    if (member?.role !== OrganizationUserRole.ADMIN) return;

    const remainingAdmins = await this.prisma.organizationUser.count({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
        userId: { not: userId },
        user: { deactivatedAt: null },
      },
    });
    if (remainingAdmins === 0) {
      // A handled refusal, so the SCIM boundary answers the directory a
      // stable code and a sentence rather than flattening it to a 500. The
      // push fails and the person is left exactly as they were, which is the
      // same order the deactivation itself keeps.
      throw new CannotDisableLastAdminError();
    }
  }

  /**
   * Coming back restores NOTHING on its own.
   *
   * The person can sign in again and they hold no access until the directory
   * asserts it — which its next full push does, for whatever it still
   * asserts. Access an administrator gave them by hand before they left stays
   * gone until an administrator gives it again, because nothing here knows
   * that it was ever meant.
   */
  private async reactivate({ id }: { id: string }): Promise<void> {
    await this.userService.reactivate({ id });
  }

  /**
   * The other half of "coming back restores nothing": letting them come back
   * at all.
   *
   * A proved deprovision removes the MEMBERSHIP ROW along with everything
   * else — that is what makes the proof pass — so the person a directory
   * reactivates has no membership for the update paths above to find, and
   * both of them would answer 404. The identity provider would then never
   * lift the sign-in block, and "they can sign in" would be false.
   *
   * So a reactivating push for somebody this connection STILL KNOWS lifts the
   * block and does nothing else: no membership, no grant, no role. They can
   * sign in, they hold nothing in the organization, and the directory's next
   * full push is what puts them back — which is exactly the sequence the spec
   * describes. A push that is not a reactivation, or one for somebody this
   * connection has forgotten (a DELETE forgets them; a deactivate does not),
   * still answers 404.
   *
   * Answers the SCIM resource when it acted, and null when the caller should
   * fall through to its own not-found.
   */
  private async reinstateSignIn({
    id,
    connectionId,
    active,
  }: {
    id: string;
    connectionId: string | null;
    active: boolean;
  }): Promise<ScimUser | null> {
    if (!active || !connectionId) return null;
    const known = await this.prisma.scimExternalId.findFirst({
      where: { connectionId, userId: id },
      select: { externalId: true },
    });
    if (!known) return null;

    const user = await this.userService.findById({ id });
    if (!user) return null;
    if (user.deactivatedAt) await this.reactivate({ id });

    const reloaded = (await this.userService.findById({ id })) ?? user;
    return this.toScimUser(reloaded);
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
    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: id,
          organizationId,
        },
      },
    });

    if (!membership) {
      const returning = await this.reinstateSignIn({
        id,
        connectionId,
        active: patchRequest.Operations.some(
          (operation) => this.activeInPatchOp(operation) === true,
        ),
      });
      return (
        returning ?? this.scimError({ status: "404", detail: "User not found" })
      );
    }

    await this.directoryIdentity.assertWritable({ connectionId, userId: id });

    // What this PATCH did to the person, for the sync's history. A PATCH that
    // turns `active` off is a removal however it is spelled, and the two
    // spellings below are both spellings of it.
    let op: "update" | "deactivate" = "update";

    for (const operation of patchRequest.Operations) {
      // Enterprise costCenter can arrive via replace/add (set) or remove
      // (clear), as a schema-qualified path or inside a value object, so it
      // is handled before the replace-only profile logic below.
      const costCenterOp = this.costCenterFromPatchOp(operation);
      if (costCenterOp.present) {
        await this.syncCostCenterFromScim({
          userId: id,
          organizationId,
          costCenter: costCenterOp.value,
        });
      }

      if (operation.op !== "replace") continue;

      // Handle path="active" with a scalar boolean value (e.g. Okta/Azure AD style)
      if (operation.path === "active") {
        if (operation.value === false || operation.value === "false") {
          await this.deactivate({ id, organizationId, connectionId });
          op = "deactivate";
        } else {
          await this.reactivate({ id });
        }
        continue;
      }

      const updates: { name?: string; email?: string } = {};

      // A NAME ARRIVES IN THREE SPELLINGS AND ONLY ONE OF THEM IS AN OBJECT.
      // `{path: "name.familyName", value: "Smith"}` is what Okta and Entra
      // actually send, and the object guard below is why it used to be
      // dropped: 200, record unchanged, request log filing it "Accepted".
      const nameParts = namePartsIn({
        path: operation.path,
        value: operation.value,
      });
      if (nameParts) {
        // Merged against the stored name, never rebuilt from the half we were
        // handed — patching a surname must not throw the forename away.
        const stored = await this.userService.findById({ id });
        const merged = mergeNameParts({ current: stored?.name, ...nameParts });
        if (merged !== undefined) updates.name = merged;
      }

      if (operation.value != null && typeof operation.value === "object") {
        const value = operation.value as Record<string, unknown>;

        if ("active" in value) {
          if (value.active === false) {
            await this.deactivate({ id, organizationId, connectionId });
            op = "deactivate";
          } else {
            await this.reactivate({ id });
          }
        }

        if ("userName" in value && typeof value.userName === "string") {
          updates.email = value.userName;
        }
      }

      if (Object.keys(updates).length > 0) {
        await this.userService.updateProfile({ id, ...updates });
      }
    }

    await this.recordPush({
      organizationId,
      connectionId,
      userId: id,
      externalId: null,
      op,
    });

    const reloadedUser = await this.userService.findById({ id });
    if (!reloadedUser) {
      return this.scimError({ status: "404", detail: "User not found" });
    }
    return this.toScimUser(reloadedUser);
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
    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: id,
          organizationId,
        },
      },
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    await this.directoryIdentity.assertWritable({ connectionId, userId: id });

    if (scimGrantsWritePathEnabled()) {
      // Through the SERVICE, whose transaction re-collects the person's
      // effective permissions inside itself and rolls the whole thing back if
      // anything still resolves. The previous code called the ledger writer
      // underneath it, which is why that proof had no production call site at
      // all. It removes the memberships too — organization, groups, legacy
      // team rows and pending invites — so nothing is left for this method to
      // delete by hand.
      await this.deprovision.removeAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "delete_user",
      });
    } else {
      await this.revokeOnThePreviousWritePath({ userId: id, organizationId });
      // A deletion also gives up the membership; a deactivation keeps it.
      await this.prisma.organizationUser.delete({
        where: { userId_organizationId: { userId: id, organizationId } },
      });
    }

    await this.userService.deactivate({ id });
    await this.forgetDirectoryIdentity({ connectionId, userId: id });
    await this.recordPush({
      organizationId,
      connectionId,
      userId: id,
      externalId: null,
      op: "deactivate",
    });
    return null;
  }

  /**
   * The person has left this directory, so the connection no longer means
   * anybody by the identifier it knew them as. Their identities on OTHER
   * connections are untouched — a contractor leaving the contractor directory
   * is not a staff member leaving.
   */
  private async forgetDirectoryIdentity({
    connectionId,
    userId,
  }: {
    connectionId: string | null;
    userId: string;
  }): Promise<void> {
    if (!connectionId) return;
    await this.prisma.scimExternalId.deleteMany({
      where: { connectionId, userId },
    });
  }

  toScimUser(user: User): ScimUser {
    const { givenName, familyName } = this.splitName(user.name ?? "");

    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      userName: user.email ?? "",
      name: {
        givenName,
        familyName,
      },
      emails: [
        {
          primary: true,
          value: user.email ?? "",
          type: "work",
        },
      ],
      active: user.deactivatedAt === null,
      meta: {
        resourceType: "User",
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
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
