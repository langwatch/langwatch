// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import {
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { UserProfile, UserService } from "@langwatch/user-contract";
import { getApp } from "~/server/app-layer/app";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
  type ScimError,
  type ScimListResponse,
  type ScimPatchOperation,
  type ScimPatchRequest,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import { reconcileScimGrants } from "./scim-grants.reconciler";

/**
 * Maps between SCIM 2.0 User resources and LangWatch User/OrganizationUser models.
 * All operations are scoped to an organization for multi-tenancy.
 */
export class ScimService {
  private readonly prisma: PrismaClient;
  private readonly writer: AuthzGrantsService;
  private readonly userService: UserService;

  constructor({
    prisma,
    writer = getApp().authzGrants,
    users = getApp().users,
  }: {
    prisma: PrismaClient;
    writer?: AuthzGrantsService;
    users?: UserService;
  }) {
    this.prisma = prisma;
    this.writer = writer;
    this.userService = users;
  }

  /**
   * The directory acts as itself, not as whoever happens to hold the SCIM
   * token. When identity connections exist this becomes the connection id
   * (ADR-092's identity-platform seam); the event shape already takes it.
   */
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
    await reconcileScimGrants({
      prisma: this.prisma,
      writer: this.writer,
      organizationId,
      where: {
        userId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
      desired: [
        {
          principal: { userId },
          role: TeamUserRole.MEMBER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
      actor: ScimService.ACTOR,
      mintBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    });
  }

  static create(options: {
    prisma: PrismaClient;
    writer?: AuthzGrantsService;
    users?: UserService;
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
      await this.assignUserCostCenter({
        organizationId,
        userId,
        departmentId: null,
      });
      return;
    }

    const department = await this.resolveCostCenterByNameOrCreate({
      organizationId,
      name: trimmed,
    });
    await this.assignUserCostCenter({
      organizationId,
      userId,
      departmentId: department.id,
    });
  }

  /**
   * Temporary app-owned bridge until Governance exposes a portable department
   * capability. It keeps SCIM independent of the legacy `@ee` module while
   * preserving the existing concurrent-create behavior.
   */
  private async resolveCostCenterByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<{ id: string }> {
    const existing = await this.prisma.department.findFirst({
      where: {
        organizationId: input.organizationId,
        name: input.name,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existing) return existing;

    try {
      return await this.prisma.department.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.department.findFirst({
          where: {
            organizationId: input.organizationId,
            name: input.name,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async assignUserCostCenter(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void> {
    const result = await this.prisma.organizationUser.updateMany({
      where: {
        userId: input.userId,
        organizationId: input.organizationId,
      },
      data: { departmentId: input.departmentId },
    });
    if (result.count === 0) {
      throw new Error(
        "SCIM cost-center assignment target was not found in this organization",
      );
    }
  }

  /**
   * Read the enterprise costCenter from a create/replace body. Returns
   * `undefined` when the enterprise extension is absent so callers can tell
   * "not provided" from "explicitly cleared".
   */
  private costCenterFromRequest(
    request: ScimCreateUserRequest,
  ): string | null | undefined {
    const ext = (request as Record<string, unknown>)[SCIM_ENTERPRISE_USER_SCHEMA] as
      | { costCenter?: string | null }
      | undefined;
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
  }: {
    request: ScimCreateUserRequest;
    organizationId: string;
  }): Promise<ScimUser | ScimError> {
    const email = request.userName;
    const name = this.buildNameFromRequest(request);

    const existingUser = await this.userService.tryFindByEmail({ email });

    if (existingUser) {
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
        await this.prisma.organizationUser.create({
          data: {
            userId: existingUser.id,
            organizationId,
            role: "MEMBER",
          },
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

      const reloadedUser = await this.userService.tryFindById({
        id: existingUser.id,
      });
      if (!reloadedUser) {
        return this.scimError({ status: "404", detail: "User not found" });
      }
      return this.toScimUser(reloadedUser);
    }

    const newUser = await this.userService.create({ name, email });

    try {
      await this.prisma.organizationUser.create({
        data: {
          userId: newUser.id,
          organizationId,
          role: "MEMBER",
        },
      });
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

    return this.toScimUser(newUser);
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
  }: {
    id: string;
    organizationId: string;
    request: ScimCreateUserRequest;
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
      return this.scimError({ status: "404", detail: "User not found" });
    }

    const name = this.buildNameFromRequest(request);
    const active = request.active !== false;

    const updatedUser = await this.userService.updateProfile({
      id,
      name,
      email: request.userName,
    });

    if (active && updatedUser.deactivatedAt) {
      await this.userService.reactivate({ id });
    } else if (!active && !updatedUser.deactivatedAt) {
      await this.userService.deactivate({ id });
    }

    await this.syncCostCenterFromScim({
      userId: id,
      organizationId,
      costCenter: this.costCenterFromRequest(request),
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
  }: {
    id: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
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
      return this.scimError({ status: "404", detail: "User not found" });
    }

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
          await this.userService.deactivate({ id });
        } else {
          await this.userService.reactivate({ id });
        }
        continue;
      }

      if (operation.value == null || typeof operation.value !== "object") continue;

      const value = operation.value as Record<string, unknown>;
      const updates: { name?: string; email?: string } = {};

      if ("active" in value) {
        if (value.active === false) {
          await this.userService.deactivate({ id });
        } else {
          await this.userService.reactivate({ id });
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
          typeof value["name.givenName"] === "string" ? value["name.givenName"] : null;
        const family =
          typeof value["name.familyName"] === "string" ? value["name.familyName"] : null;
        const parts = [given, family].filter(Boolean);
        if (parts.length > 0) {
          updates.name = parts.join(" ");
        }
      }

      if (Object.keys(updates).length > 0) {
        await this.userService.updateProfile({ id, ...updates });
      }
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
  }: {
    id: string;
    organizationId: string;
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

    // A deprovision is the fired-employee case: the grants go first and carry
    // instant enforcement (ADR-092 decision 7), so the deny holds before this
    // returns rather than whenever the queue next drains. `offboardMember`
    // (not the id-diff `reconcileScimGrants` this used to call) is what makes
    // that hold even against a lagging projection: its fold sweeps every
    // grant the principal holds, not only the ones this read could see, so a
    // grant appended moments before this push — invisible to `current` — is
    // still revoked once the fold catches up rather than surviving forever.
    // The id list below is the audit record and today's synchronous
    // enforcement, not the instruction.
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
    await this.prisma.organizationUser.delete({
      where: { userId_organizationId: { userId: id, organizationId } },
    });
    await this.userService.deactivate({ id });
    return null;
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
    if (!filter) return null;
    const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private scimError({ status, detail }: { status: string; detail: string }): ScimError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    };
  }
}
