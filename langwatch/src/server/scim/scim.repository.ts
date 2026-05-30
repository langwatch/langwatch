import {
  RoleBindingScopeType,
  TeamUserRole,
  type OrganizationUser,
  type PrismaClient,
  type User,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

export class ScimRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimRepository {
    return new ScimRepository(prisma);
  }

  async findMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUser | null> {
    return this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
    });
  }

  async findMembershipWithUser({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<(OrganizationUser & { user: User }) | null> {
    return this.prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      include: { user: true },
    });
  }

  async adoptExistingMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUser> {
    return this.prisma.organizationUser.update({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      data: { scimManaged: true },
    });
  }

  async createMembership({
    userId,
    organizationId,
    scimManaged = false,
  }: {
    userId: string;
    organizationId: string;
    scimManaged?: boolean;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.organizationUser.create({
        data: {
          userId,
          organizationId,
          role: "MEMBER",
          scimManaged,
        },
      }),
      this.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      }),
    ]);
  }

  async deleteUserAtomically({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUser.delete({
        where: { userId_organizationId: { userId, organizationId } },
      });
      await tx.roleBinding.deleteMany({
        where: { userId, organizationId },
      });
      const remainingMemberships = await tx.organizationUser.count({
        where: { userId },
      });
      if (remainingMemberships === 0) {
        await tx.user.update({
          where: { id: userId },
          data: { deactivatedAt: new Date() },
        });
      }
    });
  }

  async listMemberships({
    organizationId,
    emailFilter,
    skip,
    take,
  }: {
    organizationId: string;
    emailFilter?: string;
    skip: number;
    take: number;
  }): Promise<{ memberships: (OrganizationUser & { user: User })[]; totalCount: number }> {
    const whereClause: Record<string, unknown> = { organizationId };
    if (emailFilter) {
      whereClause.user = { email: { equals: emailFilter, mode: "insensitive" } };
    }

    const [memberships, totalCount] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: whereClause,
        include: { user: true },
        skip,
        take,
      }),
      this.prisma.organizationUser.count({ where: whereClause }),
    ]);

    return { memberships, totalCount };
  }
}
