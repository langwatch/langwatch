// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import {
  type ScimCreateUserRequest,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import { ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { admissionSeat, seatsFree, type OrganizationApi } from "@langwatch/organization-contract";
import type { UserProfile, UserApi } from "@langwatch/user-contract";

import type { ScimSeatRepository } from "../repositories/scim-seat.repository.ts";
import type {
  ScimRepository,
  ScimUserRecord,
  ScimUserResourceRecord,
} from "../repositories/scim.repository.ts";
import { ScimCostCenterService, type ScimCostCenterFacts } from "./scim-cost-center.service.ts";
import type { ScimOrganizationAdministration } from "./scim-deprovision.service.ts";
import type {
  ScimDirectoryIdentityService,
  ScimHeldConnections,
} from "./scim-directory-identity.service.ts";
import type { ScimGrantsService } from "./scim-grants.service.ts";
import { ScimMembershipAccessService } from "./scim-membership-access.service.ts";
import { ScimUserListingService } from "./scim-user-listing.service.ts";
import { ScimUserPatchService } from "./scim-user-patch.service.ts";

/**
 * Everything SCIM asks of `UserApi`: the two reads that decide whether a
 * directory user already exists here, and the create. Nothing else — a
 * directory states what is true of a person INSIDE ITS ORGANIZATION, and that
 * lives on the organization's own resource rather than on the account they
 * sign in with.
 */
export type ScimUserProvisioning = Pick<UserApi, "findById" | "findByEmail" | "create">;
import { assertScimOrganizationId } from "../rules/scim-organization-scope.rules.ts";
import { scimErrorDocument } from "../rules/scim-refusal.rules.ts";
import { isUniqueViolation, nameFromScimRequest, scimUserOf } from "../rules/scim-user.rules.ts";
import type { ScimSyncLifecycle } from "./scim-sync-lifecycle.service.ts";

/** The person this organization holds, and what it says about them. */
type ScimOrganizationUser = {
  user: ScimUserRecord;
  resource: ScimUserResourceRecord | null;
  hasMembership: boolean;
};

export class ScimProvisioningService {
  private readonly prisma: ScimRepository;
  private readonly userService: ScimUserProvisioning;
  private readonly grants: ScimGrantsService;
  private readonly provenOffboarding: boolean;
  private readonly membershipAccess: ScimMembershipAccessService;
  private readonly listing: ScimUserListingService;
  private readonly costCenters: ScimCostCenterService;
  private readonly patches: ScimUserPatchService;
  private readonly authority: Pick<ScimDirectoryIdentityService, "assertWritable">;
  private readonly seats: ScimSeatRepository;
  private readonly plans: Pick<EntitlementApi, "getActivePlan">;
  private readonly connections: ScimHeldConnections;

  private constructor({
    prisma,
    writer,
    grants,
    users,
    costCenterFacts,
    organization,
    members,
    lifecycle,
    provenOffboarding,
    authority,
    seats,
    plans,
    connections,
  }: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    costCenterFacts: ScimCostCenterFacts;
    organization: ScimOrganizationAdministration;
    members: Pick<OrganizationApi, "deleteMember">;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
    authority: Pick<ScimDirectoryIdentityService, "assertWritable">;
    seats: ScimSeatRepository;
    plans: Pick<EntitlementApi, "getActivePlan">;
    connections: ScimHeldConnections;
  }) {
    this.prisma = prisma;
    this.connections = connections;
    this.authority = authority;
    this.seats = seats;
    this.plans = plans;
    this.userService = users;
    this.grants = grants;
    this.membershipAccess = ScimMembershipAccessService.create({
      prisma,
      writer,
      grants,
      lifecycle,
      organization,
      members,
      provenOffboarding,
    });
    this.listing = ScimUserListingService.create(prisma);
    this.provenOffboarding = provenOffboarding;
    this.costCenters = ScimCostCenterService.create(costCenterFacts);
    this.patches = ScimUserPatchService.create(this.costCenters);
  }

  static create(options: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    costCenterFacts: ScimCostCenterFacts;
    organization: ScimOrganizationAdministration;
    members: Pick<OrganizationApi, "deleteMember">;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
    authority: Pick<ScimDirectoryIdentityService, "assertWritable">;
    seats: ScimSeatRepository;
    plans: Pick<EntitlementApi, "getActivePlan">;
    connections: ScimHeldConnections;
  }): ScimProvisioningService {
    return new ScimProvisioningService(options);
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

  async createUser({
    request,
    organizationId,
    connectionId = null,
  }: {
    request: ScimCreateUserRequest;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimUser> {
    assertScimOrganizationId(organizationId);
    const existingUser = await this.resolveUser({ organizationId, email: request.userName });
    // A POST naming somebody this organization still holds a resource for is a
    // return, and a return restores nothing on its own: the next push asserts it.
    let returning = false;

    if (existingUser) {
      await this.authority.assertWritable({
        organizationId,
        connectionId,
        userId: existingUser.id,
      });
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
      returning = previous !== null && previous.deletedAt === null;
      // An account another domain vouches for is never adopted by an active push.
      const admitting = request.active !== false && !returning;
      if (admitting && !(await this.isOnProvenDomain({ organizationId, user: existingUser }))) {
        return this.scimError({
          status: "409",
          scimType: "uniqueness",
          detail: "User name is held by an account outside this organization's verified domains",
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
    if (active && !returning) {
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

  /** Whether the account's address is on a domain one of the organization's connections proved. */
  private async isOnProvenDomain({
    organizationId,
    user,
  }: {
    organizationId: string;
    user: UserProfile;
  }): Promise<boolean> {
    const email = (user.email ?? "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at < 0) return false;
    const domain = email.slice(at + 1);
    const connections = await this.connections.findHeldConnections({ organizationId });

    return connections.some((connection) =>
      connection.verifiedDomains.some((proven) => proven.toLowerCase() === domain),
    );
  }

  /** A retried create still repairs the grant beside an existing membership. */
  private async admit({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const asserted = await this.directoryAssertedOrganizationRole({ userId, organizationId });
    const [plan, seats] = await Promise.all([
      this.plans.getActivePlan({ organizationId, user: { id: userId } }),
      this.seats.countMemberSeats({ organizationId }),
    ]);
    const { role, pending } = admissionSeat({ requested: asserted, ...seatsFree({ plan, seats }) });
    try {
      await this.prisma.addMembership({ userId, organizationId, role, pending });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    await this.membershipAccess.reconcileOrganizationMembership({ userId, organizationId });
  }

  /**
   * The membership row's role, from what the directory asserts: ADMIN when a SCIM group mapped
   * ADMIN at organization scope holds them under SCIM_V2_GRANTS, else MEMBER. A provisioned
   * person is a member whatever else was or was not mapped; without the flag, always MEMBER.
   */
  private async directoryAssertedOrganizationRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<"ADMIN" | "MEMBER"> {
    if (!this.provenOffboarding) return "MEMBER";
    const groupIds = await this.prisma.findDirectoryGroupIds({ userId, organizationId });
    const roles = await this.grants.findDirectoryAssertedRoles({
      organizationId,
      userId,
      groupIds,
    });
    return roles.includes("ADMIN") ? "ADMIN" : "MEMBER";
  }

  async getUser({ id, organizationId }: { id: string; organizationId: string }): Promise<ScimUser> {
    assertScimOrganizationId(organizationId);
    const found = await this.findOrganizationUser(organizationId, id);

    if (!found) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    return scimUserOf(found.user, found.resource);
  }

  /** Who this organization holds, one page at a time; see ScimUserListingService. */
  listUsers(
    input: Parameters<ScimUserListingService["listUsers"]>[0],
  ): Promise<ScimListResponse<ScimUser>> {
    return this.listing.listUsers(input);
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
      await this.membershipAccess.removeOrganizationAccess({
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
      await this.membershipAccess.removeOrganizationAccess({
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
      await this.membershipAccess.removeOrganizationAccess({
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

  private scimError(input: { status: string; detail: string; scimType?: string }): never {
    throw new ScimProtocolError(scimErrorDocument(input));
  }
}
