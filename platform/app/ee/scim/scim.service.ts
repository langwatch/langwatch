// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DepartmentService } from "@ee/governance/services/department/department.service";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { GrantsService } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import {
  type OrganizationUserRole,
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
import { MembershipLifecycleService } from "~/server/users/membership-lifecycle.service";
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
import { reconcileScimGrants } from "./scim-grants.reconciler";
import { scimGrantsWritePathEnabled } from "./scim-grants-flag";
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
  /**
   * Directory traffic is org-scoped by definition — the token that carried
   * this request belongs to one organization's IdP. Every activate /
   * deactivate below therefore goes through the membership lifecycle rather
   * than the global account flag, or one tenant's directory decides a
   * person's state inside every other tenant (#6976, ADR-094 Decision 4).
   */
  private readonly membershipLifecycle: MembershipLifecycleService;

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
    this.membershipLifecycle = MembershipLifecycleService.create(prisma);
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

      // Re-provisioning restores the membership in THIS organization and
      // lifts the global flag only if it was set. It deliberately does not
      // restore usage-attribution links — an admin relinks (ADR-094
      // Decision 4).
      await this.membershipLifecycle.onMembershipReactivated({
        organizationId,
        userId: existingUser.id,
      });

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

  async listUsers({
    organizationId,
    filter,
    startIndex = 1,
    count = 100,
  }: {
    organizationId: string;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser>> {
    const emailFilter = this.parseUserNameFilter(filter);

    const whereClause: Record<string, unknown> = {
      organizationId,
    };

    if (emailFilter) {
      whereClause.user = {
        email: { equals: emailFilter, mode: "insensitive" },
      };
    }

    const [memberships, totalCount] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: whereClause,
        include: { user: true },
        skip: startIndex - 1,
        take: count,
      }),
      this.prisma.organizationUser.count({ where: whereClause }),
    ]);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: count,
      Resources: memberships.map((m) => this.toScimUser(m.user)),
    };
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
        organizationId,
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

    await this.userService.updateProfile({
      id,
      name,
      email: request.userName,
    });

    // Branch on the MEMBERSHIP, not the account: `active: false` from this
    // directory ends this membership, and only the person's last active
    // membership takes the account with it (ADR-094 Decision 4).
    if (active && membership.disabledAt) {
      await this.reactivate({ id, organizationId });
    } else if (!active && !membership.disabledAt) {
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
    if (scimGrantsWritePathEnabled()) {
      await this.deprovision.removeAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "deactivate_user",
      });
    }
    // The MEMBERSHIP ends here, not the account: a directory speaks for its
    // own organization, and only the person's last active membership takes
    // the account with it (#6976, ADR-094 Decision 4). The closing
    // usage-attribution rows share this transaction.
    await this.membershipLifecycle.onMembershipDeactivated({
      organizationId,
      userId: id,
    });
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
  private async reactivate({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    await this.membershipLifecycle.onMembershipReactivated({
      organizationId,
      userId: id,
    });
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
    organizationId,
    connectionId,
    active,
  }: {
    id: string;
    organizationId: string;
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
    // Still creates nothing: `onMembershipReactivated` only ever updates
    // rows, so this lifts the sign-in block and re-enables a membership
    // this organization had disabled, and leaves a removed one removed.
    await this.reactivate({ id, organizationId });

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
        organizationId,
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
          await this.reactivate({ id, organizationId });
        }
        continue;
      }

      if (operation.value == null || typeof operation.value !== "object")
        continue;

      const value = operation.value as Record<string, unknown>;
      const updates: { name?: string; email?: string } = {};

      if ("active" in value) {
        if (value.active === false) {
          await this.deactivate({ id, organizationId, connectionId });
          op = "deactivate";
        } else {
          await this.reactivate({ id, organizationId });
        }
      }

      if ("userName" in value && typeof value.userName === "string") {
        updates.email = value.userName;
      }

      if ("name" in value && typeof value.name === "object") {
        const nameObj = value.name as Record<string, string>;
        const parts = [nameObj.givenName, nameObj.familyName].filter(Boolean);
        if (parts.length > 0) {
          updates.name = parts.join(" ");
        }
      } else if ("name.givenName" in value || "name.familyName" in value) {
        // Dot-notation attribute paths in value object (RFC 7644 §3.5.2)
        const given =
          typeof value["name.givenName"] === "string"
            ? value["name.givenName"]
            : null;
        const family =
          typeof value["name.familyName"] === "string"
            ? value["name.familyName"]
            : null;
        const parts = [given, family].filter(Boolean);
        if (parts.length > 0) {
          updates.name = parts.join(" ");
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
      // The closing usage-attribution rows go FIRST, while the membership
      // they are enumerated from still exists: `removeAccess` deletes the
      // membership rows itself, and a crash past that point would lose the
      // rows forever (ADR-094 Decision 4). It DISABLES rather than removes,
      // so a rollback inside `removeAccess` leaves the person denied rather
      // than restored — fail-safe, not fail-open.
      await this.membershipLifecycle.onMembershipDeactivated({
        organizationId,
        userId: id,
      });
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
      // The previous write path, unchanged, so rollback means the old
      // behaviour and not a near-miss of it. The grants go first and carry
      // instant enforcement (ADR-092 decision 7), so the deny holds before
      // this returns rather than whenever the queue next drains.
      // `offboardMember`'s fold sweeps every grant the principal holds, not
      // only the ones this read could see, so a grant appended moments before
      // this push is still revoked once the fold catches up. The id list is
      // the audit record and today's synchronous enforcement, not the
      // instruction.
      const visibleGrants = await this.prisma.roleBinding.findMany({
        where: { organizationId, userId: id },
        select: { id: true },
      });
      await this.writer.offboardMember({
        organizationId,
        userId: id,
        revokedGrantIds: visibleGrants.map((row) => row.id),
        actor: ScimService.ACTOR,
      });
      // One transaction for the removal and the closing link rows. The old
      // code committed the removal first and deactivated afterwards; a
      // crash in that gap lost the rows forever, because the IdP's retry
      // finds no membership and answers 404 before reaching step two.
      await this.membershipLifecycle.onMembershipDeactivated({
        organizationId,
        userId: id,
        membershipChange: "remove",
      });
    }

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

  private parseUserNameFilter(filter?: string): string | null {
    if (!filter) return null;
    const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private scimError({
    status,
    detail,
  }: {
    status: string;
    detail: string;
  }): ScimError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    };
  }
}
