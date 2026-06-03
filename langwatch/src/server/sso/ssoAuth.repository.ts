import type {
  OrganizationUser,
  OrganizationUserRole,
  PrismaClient,
  User,
} from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Membership/RBAC persistence for the SSO provisioning bridge. User, account,
 * and session rows are owned by the @better-auth/sso plugin (via better-auth's
 * adapter), so this repository only touches LangWatch's own org models.
 */
export class SsoAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): SsoAuthRepository {
    return new SsoAuthRepository(prisma);
  }

  async findUserByEmail({ email }: { email: string }): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email } });
  }

  async isUserDeactivated({ userId }: { userId: string }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deactivatedAt: true },
    });
    return !!user?.deactivatedAt;
  }

  async findMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Pick<OrganizationUser, "role" | "scimManaged"> | null> {
    return this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, scimManaged: true },
    });
  }

  async createMembership({
    userId,
    organizationId,
    role,
  }: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
  }): Promise<void> {
    const teamRole = role === "ADMIN" ? TeamUserRole.ADMIN : TeamUserRole.MEMBER;

    await this.prisma.$transaction([
      this.prisma.organizationUser.create({
        data: { userId, organizationId, role },
      }),
      this.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId,
          role: teamRole,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      }),
    ]);
  }

  async isSoleAdmin({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const activeAdminCount = await this.prisma.organizationUser.count({
      where: {
        organizationId,
        role: "ADMIN",
        user: { deactivatedAt: null },
      },
    });

    if (activeAdminCount !== 1) return false;

    const userIsAdmin = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId, role: "ADMIN" },
      select: { userId: true },
    });

    return !!userIsAdmin;
  }

  async updateMembershipRole({
    userId,
    organizationId,
    role,
  }: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
  }): Promise<void> {
    await this.prisma.organizationUser.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { role },
    });
  }
}
