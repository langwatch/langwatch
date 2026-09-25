// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type {
  AuthzGrantsService,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/authz-contract";
import {
  type ScimCreateUserRequest,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import { ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type { UserProfile, UserApi } from "@langwatch/user-contract";

import type {
  ScimRepository,
  ScimUserRecord,
  ScimUserResourceRecord,
} from "../repositories/scim.repository.ts";
import {
  ScimCostCenterService,
  type ScimDepartmentAssignment,
} from "./scim-cost-center.service.ts";
import {
  ScimDeprovisionService,
  type ScimOrganizationAdministration,
} from "./scim-deprovision.service.ts";
import type { ScimGrantsService } from "./scim-grants.service.ts";
import { ScimUserPatchService } from "./scim-user-patch.service.ts";

/**
 * Everything SCIM asks of `UserApi`: the two reads that decide whether a
 * directory user already exists here, and the create. Nothing else — a
 * directory states what is true of a person INSIDE ITS ORGANIZATION, and that
 * lives on the organization's own resource rather than on the account they
 * sign in with.
 */
export type ScimUserProvisioning = Pick<UserApi, "findById" | "findByEmail" | "create">;
import type { ScimSyncLifecycle } from "../app/scim.members.ts";
import { parseScimFilter, type ScimFilterTerm } from "../rules/scim-filter.rules.ts";
import { assertScimOrganizationId } from "../rules/scim-organization-scope.rules.ts";
import { isUniqueViolation, nameFromScimRequest, scimUserOf } from "../rules/scim-user.rules.ts";

/** The person this organization holds, and what it says about them. */
type ScimOrganizationUser = {
  user: ScimUserRecord;
  resource: ScimUserResourceRecord | null;
  hasMembership: boolean;
};

export class ScimProvisioningService {
  private readonly prisma: ScimRepository;
  private readonly writer: AuthzGrantsService;
  private readonly userService: ScimUserProvisioning;
  private readonly grants: ScimGrantsService;
  private readonly deprovision: ScimDeprovisionService;
  private readonly organization: ScimOrganizationAdministration;
  private readonly provenOffboarding: boolean;
  private readonly costCenters: ScimCostCenterService;
  private readonly patches: ScimUserPatchService;

  private constructor({
    prisma,
    writer,
    grants,
    users,
    governance,
    organization,
    lifecycle,
    provenOffboarding,
  }: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    governance: ScimDepartmentAssignment;
    organization: ScimOrganizationAdministration;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
  }) {
    this.prisma = prisma;
    this.writer = writer;
    this.userService = users;
    this.grants = grants;
    this.deprovision = ScimDeprovisionService.create({
      grants: writer,
      lifecycle,
      organization,
    });
    this.provenOffboarding = provenOffboarding;
    this.costCenters = ScimCostCenterService.create(governance);
    this.organization = organization;
    this.patches = ScimUserPatchService.create(this.costCenters);
  }

  static create(options: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    governance: ScimDepartmentAssignment;
    organization: ScimOrganizationAdministration;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
  }): ScimProvisioningService {
    return new ScimProvisioningService(options);
  }

  private static readonly ACTOR = {
    type: "system",
    id: SYSTEM_ACTORS.scim,
  } as const;

  /**
   * The organization-scoped membership grant a directory push asserts,
   * reconciled rather than written: re-pushing the same state emits nothing.
   *
   * With `SCIM_V2_GRANTS` on there is nothing to assert — a group's grant is
   * what carries the access — so the push retires the duplicate an older one
   * minted instead of restating it.
   */
  private async reconcileOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    if (this.provenOffboarding) {
      await this.grants.retireMembershipGrants({
        organizationId,
        userIds: [userId],
        actor: ScimProvisioningService.ACTOR,
      });

      return;
    }

    await this.grants.reconcile({
      scope: {
        kind: "organization-membership",
        organizationId,
        userId,
      },
      desired: [
        {
          principal: { userId },
          role: "MEMBER" as TeamUserRole,
          customRoleId: null,
          scopeType: "ORGANIZATION" as RoleBindingScopeType,
          scopeId: organizationId,
        },
      ],
      actor: ScimProvisioningService.ACTOR,
    });
  }

  /**
   * Who a push means, inside this organization: the person a live resource of
   * that name belongs to, else the account that answers to it. A directory
   * alias is only ever read here — never as sign-in proof.
   */
  private async resolveUser({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string;
  }): Promise<UserProfile | null> {
    return (
      (await this.prisma.findUserByResourceName({ organizationId, userName: email })) ??
      (await this.userService.findByEmail({ email }))
    );
  }

  /**
   * The person as this organization holds them. A deleted resource answers for
   * nobody even while the account and its other organizations carry on.
   */
  private async findOrganizationUser(
    organizationId: string,
    id: string,
  ): Promise<ScimOrganizationUser | null> {
    const [resource, membership] = await Promise.all([
      this.prisma.findUserResource({ organizationId, userId: id }),
      this.prisma.findMembership({ organizationId, userId: id }),
    ]);
    if (resource?.deletedAt || (!resource && !membership)) return null;

    const user = await this.userService.findById({ id });

    return user ? { user, resource, hasMembership: membership !== null } : null;
  }

  /** A name one person already answers to in this organization is refused, not taken. */
  private async assertUserNameIsFree({
    organizationId,
    userId,
    userName,
  }: {
    organizationId: string;
    userId?: string;
    userName: string;
  }): Promise<void> {
    const holder = await this.prisma.findUserByResourceName({ organizationId, userName });
    const conflicting =
      (holder !== null && holder.id !== userId) ||
      (await this.prisma.hasLegacyNameConflict({ organizationId, userId, userName }));

    if (conflicting) {
      this.scimError({
        status: "409",
        scimType: "uniqueness",
        detail: "User name already exists in this organization",
      });
    }
  }

  /** The store's own uniqueness is the last word, and it reads as 409 too. */
  private async saveResource(input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
    active: boolean;
  }): Promise<ScimUserResourceRecord> {
    try {
      return await this.prisma.saveUserResource(input);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      return this.scimError({
        status: "409",
        scimType: "uniqueness",
        detail: "User name already exists in this organization",
      });
    }
  }

  /**
   * Access in this organization goes before the resource is marked inactive,
   * and the organization's own last-administrator refusal is asked either way:
   * the flag chooses HOW access is removed, never whether an organization may
   * be left with nobody to administer it.
   */
  private async removeOrganizationAccess({
    userId,
    organizationId,
    connectionId,
    op,
  }: {
    userId: string;
    organizationId: string;
    connectionId: string | null;
    op: "deactivate_user" | "delete_user";
  }): Promise<void> {
    if (this.provenOffboarding) {
      await this.deprovision.removeAccess({ userId, organizationId, connectionId, op });

      return;
    }

    await this.organization.assertRemovalKeepsAnAdministrator({ organizationId, userId });
    const visibleGrants = await this.prisma.findRoleBindings({
      kind: "member-offboarding",
      organizationId,
      userId,
    });
    await this.writer.offboardMember({
      organizationId,
      userId,
      revokedGrantIds: visibleGrants.map((row) => row.id),
      actor: ScimProvisioningService.ACTOR,
    });
    await this.prisma.removeMembership({ userId, organizationId });
  }

  async createUser({
    request,
    organizationId,
  }: {
    request: ScimCreateUserRequest;
    organizationId: string;
  }): Promise<ScimUser> {
    assertScimOrganizationId(organizationId);
    const existingUser = await this.resolveUser({ organizationId, email: request.userName });

    if (existingUser) {
      const [membership, previous] = await Promise.all([
        this.prisma.findMembership({ organizationId, userId: existingUser.id }),
        this.prisma.findUserResource({ organizationId, userId: existingUser.id }),
      ]);
      if (membership && !previous?.deletedAt) {
        return this.scimError({
          status: "409",
          detail: "User already exists in this organization",
        });
      }
    }

    await this.assertUserNameIsFree({
      organizationId,
      ...(existingUser ? { userId: existingUser.id } : {}),
      userName: request.userName,
    });

    const name = nameFromScimRequest(request);
    // Minting the account is the only global state a directory push writes.
    const user = existingUser ?? (await this.userService.create({ name, email: request.userName }));
    const active = request.active !== false;

    if (active) {
      await this.admit({ userId: user.id, organizationId });
      await this.costCenters.sync({
        userId: user.id,
        organizationId,
        costCenter: this.costCenters.findFromRequest(request),
      });
    }

    const resource = await this.saveResource({
      organizationId,
      userId: user.id,
      userName: request.userName,
      name,
      active,
    });

    return scimUserOf(user, resource);
  }

  /** A retried create still repairs the grant beside an existing membership. */
  private async admit({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    try {
      await this.prisma.addMembership({ userId, organizationId, role: "MEMBER" });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    await this.reconcileOrganizationMembership({ userId, organizationId });
  }

  async getUser({ id, organizationId }: { id: string; organizationId: string }): Promise<ScimUser> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);

    if (!found) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    return scimUserOf(found.user, found.resource);
  }

  /**
   * Who this organization holds, one page at a time. Three things here are
   * load-bearing only once the directory is bigger than one page: the order a
   * page is cut from is settled by the store (see the repository), the page
   * reports what it holds rather than what was asked for (RFC 7644 §3.4.2.4),
   * and a filter is honoured or refused, never dropped (ADR-002).
   */
  async listUsers({
    organizationId,
    connectionId = null,
    filter,
    startIndex = 1,
    count = 100,
  }: {
    organizationId: string;
    /** Whose directory identifiers an `externalId` filter resolves against. A
     *  filter on one connection's identifier must never find another
     *  connection's person, and the pair is the key that keeps them apart. */
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser>> {
    assertScimOrganizationId(organizationId);
    const parsed = parseScimFilter({ filter, supported: ["userName", "externalId"] });
    if (!parsed.ok) {
      return this.scimError({ status: "400", scimType: "invalidFilter", detail: parsed.detail });
    }

    const narrowing = await this.listNarrowing({ connectionId, term: parsed.term });

    const { rows, total: totalCount } = await this.prisma.findOrganizationUsers({
      organizationId,
      ...narrowing,
      startIndex,
      count,
    });
    const resources = rows.map((row) => scimUserOf(row.user, row.resource));

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /**
   * An `externalId` term resolves through the connection that asserted it. An
   * identifier this connection has never seen narrows to NOBODY rather than
   * widening back to everybody, which is the honest answer to "who do you hold
   * under this identifier" when the answer is nobody.
   */
  private async listNarrowing({
    connectionId,
    term,
  }: {
    connectionId: string | null;
    term: ScimFilterTerm | null;
  }): Promise<{ userName?: string; userIds?: readonly string[] }> {
    if (!term) return {};

    if (term.attribute === "externalId") {
      const userId = connectionId
        ? await this.prisma.findDirectoryUserId({ connectionId, externalId: term.value })
        : null;

      return { userIds: userId ? [userId] : [] };
    }

    return { userName: term.value };
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
  }): Promise<ScimUser> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);

    if (!found) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    await this.assertUserNameIsFree({ organizationId, userId: id, userName: request.userName });
    const active = request.active !== false;

    if (!active && found.hasMembership) {
      await this.removeOrganizationAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "deactivate_user",
      });
    } else if (active && found.hasMembership) {
      await this.costCenters.sync({
        userId: id,
        organizationId,
        costCenter: this.costCenters.findFromRequest(request),
      });
    }

    const resource = await this.saveResource({
      organizationId,
      userId: id,
      userName: request.userName,
      name: nameFromScimRequest(request),
      active,
    });

    return scimUserOf(found.user, resource);
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
  }): Promise<ScimUser> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);

    if (!found) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    const patched = this.patches.fold({
      operations: patchRequest.Operations,
      active: found.resource?.active ?? found.user.deactivatedAt === null,
      name: found.resource ? found.resource.name : found.user.name,
      userName: found.resource?.userName ?? found.user.email ?? "",
    });
    await this.assertUserNameIsFree({ organizationId, userId: id, userName: patched.userName });

    if (patched.deactivating && found.hasMembership) {
      await this.removeOrganizationAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "deactivate_user",
      });
    } else if (found.hasMembership) {
      for (const costCenter of patched.costCenters) {
        await this.costCenters.sync({ userId: id, organizationId, costCenter });
      }
    }

    const resource = await this.saveResource({
      organizationId,
      userId: id,
      userName: patched.userName,
      name: patched.name,
      active: patched.active,
    });

    return scimUserOf(found.user, resource);
  }

  async deleteUser({
    id,
    organizationId,
    connectionId = null,
  }: {
    id: string;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<void> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);

    if (!found) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    if (found.hasMembership) {
      await this.removeOrganizationAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "delete_user",
      });
    }

    await this.prisma.markUserResourceDeleted({
      organizationId,
      userId: id,
      userName: found.resource?.userName ?? found.user.email ?? "",
      name: found.resource ? found.resource.name : found.user.name,
    });
  }

  toScimUser(user: UserProfile, resource?: ScimUserResourceRecord | null): ScimUser {
    return scimUserOf(user, resource);
  }

  private scimError({
    status,
    detail,
    scimType,
  }: {
    status: string;
    detail: string;
    scimType?: string;
  }): never {
    throw new ScimProtocolError({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
      ...(scimType === undefined ? {} : { scimType }),
    });
  }
}
