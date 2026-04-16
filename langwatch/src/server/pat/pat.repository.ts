import type { PrismaClient, PersonalAccessToken, RoleBinding } from "@prisma/client";

export type PatWithBindings = PersonalAccessToken & {
  roleBindings: RoleBinding[];
};

export class PatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): PatRepository {
    return new PatRepository(prisma);
  }

  async create({
    name,
    lookupId,
    hashedSecret,
    userId,
    organizationId,
    expiresAt,
  }: {
    name: string;
    lookupId: string;
    hashedSecret: string;
    userId: string;
    organizationId: string;
    expiresAt?: Date | null;
  }): Promise<PersonalAccessToken> {
    return this.prisma.personalAccessToken.create({
      data: { name, lookupId, hashedSecret, userId, organizationId, expiresAt: expiresAt ?? null },
    });
  }

  async findByLookupId({
    lookupId,
  }: {
    lookupId: string;
  }): Promise<PatWithBindings | null> {
    // Reject PATs whose owning user has been deactivated. We use findFirst
    // rather than findUnique because Prisma's findUnique does not accept
    // related filters; lookupId is @unique so the result is still unique.
    return this.prisma.personalAccessToken.findFirst({
      where: {
        lookupId,
        user: { deactivatedAt: null },
      },
      include: { roleBindings: true },
    });
  }

  async findById({
    id,
  }: {
    id: string;
  }): Promise<PatWithBindings | null> {
    return this.prisma.personalAccessToken.findUnique({
      where: { id },
      include: { roleBindings: true },
    });
  }

  async findAllByUser({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PatWithBindings[]> {
    return this.prisma.personalAccessToken.findMany({
      where: { userId, organizationId },
      include: {
        roleBindings: {
          include: { customRole: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke({ id }: { id: string }): Promise<PersonalAccessToken> {
    return this.prisma.personalAccessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async updateLastUsedAt({ id }: { id: string }): Promise<void> {
    await this.prisma.personalAccessToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async createRoleBindings({
    patId,
    organizationId,
    bindings,
  }: {
    patId: string;
    organizationId: string;
    bindings: Array<{
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  }): Promise<RoleBinding[]> {
    const created = await Promise.all(
      bindings.map((b) =>
        this.prisma.roleBinding.create({
          data: {
            organizationId,
            patId,
            role: b.role,
            customRoleId: b.role === "CUSTOM" ? (b.customRoleId ?? null) : null,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          },
        }),
      ),
    );
    return created;
  }
}
