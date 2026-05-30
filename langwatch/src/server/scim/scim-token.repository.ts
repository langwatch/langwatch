import { Prisma, type PrismaClient, type ScimToken } from "@prisma/client";

export class ScimTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimTokenRepository {
    return new ScimTokenRepository(prisma);
  }

  async create({
    organizationId,
    hashedToken,
    description,
  }: {
    organizationId: string;
    hashedToken: string;
    description: string | null;
  }): Promise<ScimToken> {
    return this.prisma.scimToken.create({
      data: { organizationId, hashedToken, description },
    });
  }

  async findByHashedToken({
    hashedToken,
  }: {
    hashedToken: string;
  }): Promise<ScimToken | null> {
    return this.prisma.scimToken.findFirst({
      where: { hashedToken },
    });
  }

  async updateLastUsed({ id }: { id: string }): Promise<void> {
    await this.prisma.scimToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<
    Array<{
      id: string;
      description: string | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>
  > {
    return this.prisma.scimToken.findMany({
      where: { organizationId },
      select: {
        id: true,
        description: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    try {
      await this.prisma.scimToken.delete({
        where: { id, organizationId },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return;
      }
      throw err;
    }
  }
}
