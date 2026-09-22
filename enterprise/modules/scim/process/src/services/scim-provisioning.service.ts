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

import type { ScimRepository } from "../repositories/scim.repository.ts";
import {
  ScimCostCenterService,
  type ScimDepartmentAssignment,
} from "./scim-cost-center.service.ts";
import {
  ScimDeprovisionService,
  type ScimOrganizationAdministration,
} from "./scim-deprovision.service.ts";
import { ScimGrantsService } from "./scim-grants.service.ts";
import { ScimUserPatchService, type ScimUserActivation } from "./scim-user-patch.service.ts";
import {
  ScimUserProfileService,
  type ScimSessionRevocation,
  type ScimUserProfileReadWrite,
} from "./scim-user-profile.service.ts";

/**
 * Everything SCIM asks of `UserApi`: the two reads that decide whether a
 * directory user already exists here, the create, and what the leaf services
 * need to change a profile or flip `active`. Six of the contract's twenty-two
 * members.
 */
export type ScimUserProvisioning = ScimUserActivation &
  ScimUserProfileReadWrite &
  Pick<UserApi, "findByEmail" | "create">;
import type { ScimSyncLifecycle } from "../app/scim.members.ts";
import { parseScimFilter, type ScimFilterTerm } from "../rules/scim-filter.rules.ts";
import { assertScimOrganizationId } from "../rules/scim-organization-scope.rules.ts";
import { isUniqueViolation, nameFromScimRequest, scimUserOf } from "../rules/scim-user.rules.ts";

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
  private readonly profiles: ScimUserProfileService;

  private constructor({
    prisma,
    writer,
    grants,
    users,
    auth,
    governance,
    organization,
    lifecycle,
    provenOffboarding,
  }: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    auth: ScimSessionRevocation;
    governance: ScimDepartmentAssignment;
    organization: ScimOrganizationAdministration;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
  }) {
    this.prisma = prisma;
    this.writer = writer;
    this.userService = users;
    this.profiles = ScimUserProfileService.create({ users, auth });
    this.grants = grants;
    this.deprovision = ScimDeprovisionService.create({
      grants: writer,
      lifecycle,
      organization,
    });
    this.provenOffboarding = provenOffboarding;
    this.costCenters = ScimCostCenterService.create(governance);
    this.organization = organization;
    this.patches = ScimUserPatchService.create(
      this.userService,
      this.profiles,
      this.costCenters,
      this.deprovision,
      organization,
      provenOffboarding,
    );
  }

  static create(options: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    auth: ScimSessionRevocation;
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

  async createUser({
    request,
    organizationId,
  }: {
    request: ScimCreateUserRequest;
    organizationId: string;
  }): Promise<ScimUser> {
    const email = request.userName;
    const name = nameFromScimRequest(request);

    const existingUser = await this.userService.findByEmail({ email });

    if (existingUser) {
      return this.createExistingUser({ existingUser, organizationId, request });
    }

    return this.createNewUser({ name, email, organizationId, request });
  }

  private async createExistingUser({
    existingUser,
    organizationId,
    request,
  }: {
    existingUser: UserProfile;
    organizationId: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser> {
    const existingMembership = await this.prisma.findMembership({
      userId: existingUser.id,
      organizationId,
    });
    if (existingMembership) {
      return this.scimError({
        status: "409",
        detail: "User already exists in this organization",
      });
    }

    try {
      await this.prisma.addMembership({
        userId: existingUser.id,
        organizationId,
        role: "MEMBER",
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      await this.reconcileOrganizationMembership({
        userId: existingUser.id,
        organizationId,
      });

      return this.toScimUser(existingUser);
    }

    await this.reconcileOrganizationMembership({
      userId: existingUser.id,
      organizationId,
    });
    if (existingUser.deactivatedAt) {
      await this.userService.reactivate({ id: existingUser.id });
    }

    await this.costCenters.sync({
      userId: existingUser.id,
      organizationId,
      costCenter: this.costCenters.findFromRequest(request),
    });

    const reloadedUser = await this.userService.findById({ id: existingUser.id });
    if (!reloadedUser) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    return this.toScimUser(reloadedUser);
  }

  private async createNewUser({
    name,
    email,
    organizationId,
    request,
  }: {
    name: string;
    email: string;
    organizationId: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser> {
    const newUser = await this.userService.create({ name, email });
    try {
      await this.prisma.addMembership({
        userId: newUser.id,
        organizationId,
        role: "MEMBER",
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.scimError({
          status: "409",
          detail: "User already exists in this organization",
        });
      }

      throw error;
    }

    await this.reconcileOrganizationMembership({
      userId: newUser.id,
      organizationId,
    });
    await this.costCenters.sync({
      userId: newUser.id,
      organizationId,
      costCenter: this.costCenters.findFromRequest(request),
    });

    return this.toScimUser(newUser);
  }

  async getUser({ id, organizationId }: { id: string; organizationId: string }): Promise<ScimUser> {
    const membership = await this.prisma.findMembership({
      userId: id,
      organizationId,
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    return this.toScimUser(membership.user);
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

    const { rows: memberships, total: totalCount } = await this.prisma.listMemberships({
      organizationId,
      ...narrowing,
      startIndex,
      count,
    });
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
  }): Promise<{ email?: string; userIds?: readonly string[] }> {
    if (!term) return {};

    if (term.attribute === "externalId") {
      const userId = connectionId
        ? await this.prisma.findDirectoryUserId({ connectionId, externalId: term.value })
        : null;

      return { userIds: userId ? [userId] : [] };
    }

    return { email: term.value };
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
    const membership = await this.prisma.findMembership({
      userId: id,
      organizationId,
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    const name = nameFromScimRequest(request);
    const active = request.active !== false;

    const updatedUser = await this.profiles.updateProfile({
      id,
      name,
      email: request.userName,
    });

    if (active && updatedUser.deactivatedAt) {
      await this.userService.reactivate({ id });
    } else if (!active && !updatedUser.deactivatedAt) {
      if (this.provenOffboarding) {
        await this.deprovision.removeAccess({
          userId: id,
          organizationId,
          connectionId,
          op: "deactivate_user",
        });
      } else {
        await this.organization.assertRemovalKeepsAnAdministrator({
          organizationId,
          userId: id,
        });
      }

      await this.userService.deactivate({ id });
    }

    await this.costCenters.sync({
      userId: id,
      organizationId,
      costCenter: this.costCenters.findFromRequest(request),
    });

    const reloadedUser = await this.userService.findById({ id });
    if (!reloadedUser) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    return this.toScimUser(reloadedUser);
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
    const membership = await this.prisma.findMembership({
      userId: id,
      organizationId,
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    for (const operation of patchRequest.Operations) {
      await this.patches.apply({ id, organizationId, connectionId, operation });
    }

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
  }): Promise<void> {
    const membership = await this.prisma.findMembership({
      userId: id,
      organizationId,
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    if (this.provenOffboarding) {
      await this.deprovision.removeAccess({
        userId: id,
        organizationId,
        connectionId,
        op: "delete_user",
      });
    } else {
      // The previous write path removes the membership row itself, so it asks
      // the same refusal the proven path asks through `removeAccess`.
      await this.organization.assertRemovalKeepsAnAdministrator({
        organizationId,
        userId: id,
      });
      const visibleGrants = await this.prisma.listRoleBindings({
        kind: "member-offboarding",
        organizationId,
        userId: id,
      });
      await this.writer.offboardMember({
        organizationId,
        userId: id,
        revokedGrantIds: visibleGrants.map((row) => row.id),
        actor: ScimProvisioningService.ACTOR,
      });
      await this.prisma.removeMembership({ userId: id, organizationId });
    }

    await this.userService.deactivate({ id });

    return;
  }

  toScimUser(user: UserProfile): ScimUser {
    return scimUserOf(user);
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
