// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { RoleBindingScopeType, TeamUserRole } from "@langwatch/authz-contract";
import type { UserProfile, UserService } from "@langwatch/user-contract";
import {
  type ScimCreateUserRequest,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import { ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type { ScimRepositoryPort } from "../ports/scim-repository.port";
import { ScimGrantsService } from "./scim-grants.service";
import { ScimCostCenterService, type ScimDepartmentAssignment } from "./scim-cost-center.service";
import { ScimDeprovisionService } from "./scim-deprovision.service";
import { ScimUserPatchService, type ScimUserActivation } from "./scim-user-patch.service";
import {
  ScimUserProfileService,
  type ScimSessionRevocation,
  type ScimUserProfileReadWrite,
} from "./scim-user-profile.service";

/**
 * Everything SCIM asks of `UserService`: the two reads that decide whether a
 * directory user already exists here, the create, and what the leaf services
 * need to change a profile or flip `active`. Six of the contract's twenty-two
 * members.
 */
export type ScimUserProvisioning = ScimUserActivation &
  ScimUserProfileReadWrite &
  Pick<UserService, "tryFindByEmail" | "create">;
import type { ScimSyncLifecyclePort } from "../ports/scim-sync-lifecycle.port";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

export class ScimProvisioningService {
  private readonly prisma: ScimRepositoryPort;
  private readonly writer: AuthzGrantsService;
  private readonly userService: ScimUserProvisioning;
  private readonly grants: ScimGrantsService;
  private readonly deprovision: ScimDeprovisionService;
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
    lifecycle,
    provenOffboarding,
  }: {
    prisma: ScimRepositoryPort;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    auth: ScimSessionRevocation;
    governance: ScimDepartmentAssignment;
    lifecycle: ScimSyncLifecyclePort;
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
    });
    this.provenOffboarding = provenOffboarding;
    this.costCenters = ScimCostCenterService.create(governance);
    this.patches = ScimUserPatchService.create(
      this.userService,
      this.profiles,
      this.costCenters,
      this.deprovision,
      provenOffboarding,
    );
  }

  static create(options: {
    prisma: ScimRepositoryPort;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    users: ScimUserProvisioning;
    auth: ScimSessionRevocation;
    governance: ScimDepartmentAssignment;
    lifecycle: ScimSyncLifecyclePort;
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
   */
  private async reconcileOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
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
    const name = this.buildNameFromRequest(request);

    const existingUser = await this.userService.tryFindByEmail({ email });

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
    const existingMembership = await this.prisma.tryFindMembership({
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
      costCenter: this.costCenters.tryFromRequest(request),
    });

    const reloadedUser = await this.userService.tryFindById({ id: existingUser.id });
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
      costCenter: this.costCenters.tryFromRequest(request),
    });
    return this.toScimUser(newUser);
  }

  async getUser({ id, organizationId }: { id: string; organizationId: string }): Promise<ScimUser> {
    const membership = await this.prisma.tryFindMembership({
      userId: id,
      organizationId,
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

    const { rows: memberships, total: totalCount } = await this.prisma.listMemberships({
      organizationId,
      email: emailFilter ?? undefined,
      startIndex,
      count,
    });

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
  }): Promise<ScimUser> {
    const membership = await this.prisma.tryFindMembership({
      userId: id,
      organizationId,
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    const name = this.buildNameFromRequest(request);
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
      }
      await this.userService.deactivate({ id });
    }

    await this.costCenters.sync({
      userId: id,
      organizationId,
      costCenter: this.costCenters.tryFromRequest(request),
    });

    const reloadedUser = await this.userService.tryFindById({ id });
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
    const membership = await this.prisma.tryFindMembership({
      userId: id,
      organizationId,
    });

    if (!membership) {
      return this.scimError({ status: "404", detail: "User not found" });
    }

    for (const operation of patchRequest.Operations) {
      await this.patches.apply({ id, organizationId, connectionId, operation });
    }

    const reloadedUser = await this.userService.tryFindById({ id });
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
    const membership = await this.prisma.tryFindMembership({
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
      const parts = [request.name.givenName, request.name.familyName].filter(Boolean);
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
    if (!filter) {
      return null;
    }
    const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private scimError({ status, detail }: { status: string; detail: string }): never {
    throw new ScimProtocolError({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    });
  }
}
