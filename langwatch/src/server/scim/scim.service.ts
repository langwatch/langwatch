import type { PrismaClient, User } from "@prisma/client";
import { UserService } from "../users/user.service";
import type {
  ScimUser,
  ScimListResponse,
  ScimError,
  ScimCreateUserRequest,
  ScimPatchRequest,
} from "./scim.types";

/**
 * Maps between SCIM 2.0 User resources and LangWatch User/OrganizationUser models.
 * All operations are scoped to an organization for multi-tenancy.
 */
export class ScimService {
  private readonly userService: UserService;

  constructor(private readonly prisma: PrismaClient) {
    this.userService = UserService.create(prisma);
  }

  static create(prisma: PrismaClient): ScimService {
    return new ScimService(prisma);
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

    const existingUser = await this.userService.findByEmail({ email });

    if (existingUser) {
      const existingMembership =
        await this.prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: existingUser.id,
              organizationId,
            },
          },
        });

      if (existingMembership) {
        return this.scimError({ status: "409", detail: "User already exists in this organization" });
      }

      await this.prisma.organizationUser.create({
        data: {
          userId: existingUser.id,
          organizationId,
          role: "MEMBER",
        },
      });

      if (existingUser.deactivatedAt) {
        await this.userService.reactivate({ id: existingUser.id });
      }

      const reloadedUser = await this.userService.findById({ id: existingUser.id });
      return this.toScimUser(reloadedUser!);
    }

    const newUser = await this.userService.create({ name, email });

    await this.prisma.organizationUser.create({
      data: {
        userId: newUser.id,
        organizationId,
        role: "MEMBER",
      },
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
      whereClause.user = { email: emailFilter };
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

    const reloadedUser = await this.userService.findById({ id });
    return this.toScimUser(reloadedUser!);
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
      if (operation.op === "replace" && operation.value) {
        const updates: { name?: string; email?: string } = {};

        if ("active" in operation.value) {
          if (operation.value.active === false) {
            await this.userService.deactivate({ id });
          } else {
            await this.userService.reactivate({ id });
          }
        }

        if ("userName" in operation.value && typeof operation.value.userName === "string") {
          updates.email = operation.value.userName;
        }

        if ("name" in operation.value && typeof operation.value.name === "object") {
          const nameObj = operation.value.name as Record<string, string>;
          const parts = [nameObj.givenName, nameObj.familyName].filter(Boolean);
          if (parts.length > 0) {
            updates.name = parts.join(" ");
          }
        }

        if (Object.keys(updates).length > 0) {
          await this.userService.updateProfile({ id, ...updates });
        }
      }
    }

    const reloadedUser = await this.userService.findById({ id });
    return this.toScimUser(reloadedUser!);
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

    await this.userService.deactivate({ id });
    return null;
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
      const parts = [request.name.givenName, request.name.familyName].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }
    return request.userName.split("@")[0] ?? request.userName;
  }

  private splitName(fullName: string): { givenName: string; familyName: string } {
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
