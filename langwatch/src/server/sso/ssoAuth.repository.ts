import type { PrismaClient, User, Account, OrganizationUser, OrganizationUserRole } from "@prisma/client";

export class SsoAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): SsoAuthRepository {
    return new SsoAuthRepository(prisma);
  }

  async findUserByEmail({
    email,
  }: {
    email: string;
  }): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email },
    });
  }

  async createUser({
    email,
    name,
    image,
  }: {
    email: string;
    name: string;
    image: string | null;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email,
        name,
        image,
        emailVerified: true,
      },
    });
  }

  async findAccount({
    userId,
    provider,
    providerAccountId,
  }: {
    userId: string;
    provider: string;
    providerAccountId: string;
  }): Promise<Account | null> {
    return this.prisma.account.findFirst({
      where: { userId, provider, providerAccountId },
    });
  }

  async createAccount({
    userId,
    provider,
    providerAccountId,
  }: {
    userId: string;
    provider: string;
    providerAccountId: string;
  }): Promise<Account> {
    return this.prisma.account.create({
      data: {
        userId,
        provider,
        providerAccountId,
        accountId: providerAccountId,
      },
    });
  }

  async createSession({
    sessionToken,
    userId,
    expiresAt,
    ipAddress,
    userAgent,
  }: {
    sessionToken: string;
    userId: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: expiresAt,
        ssoAuthenticatedAt: new Date(),
        ipAddress,
        userAgent,
      },
    });
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
