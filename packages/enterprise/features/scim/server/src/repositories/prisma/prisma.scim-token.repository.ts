import { ScimTokenRepository } from "../../services/scim-token.service";
import type { ScimTokenDatabase } from "../../ports/scim-token-database.port";

export class PrismaScimTokenRepository extends ScimTokenRepository {
  private constructor(private readonly database: ScimTokenDatabase) {
    super();
  }

  static create(database: ScimTokenDatabase): PrismaScimTokenRepository {
    return new PrismaScimTokenRepository(database);
  }

  create(input: {
    organizationId: string;
    hashedToken: string;
    description: string | null;
  }): ReturnType<ScimTokenDatabase["scimToken"]["create"]> {
    return this.database.scimToken.create({ data: input });
  }

  list(organizationId: string): ReturnType<ScimTokenDatabase["scimToken"]["findMany"]> {
    return this.database.scimToken.findMany({
      where: { organizationId },
      select: { id: true, description: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(input: { organizationId: string; tokenId: string }): Promise<boolean> {
    const result = await this.database.scimToken.deleteMany({
      where: { id: input.tokenId, organizationId: input.organizationId },
    });
    return result.count > 0;
  }

  tryFindByHash(
    hashedToken: string,
  ): ReturnType<ScimTokenDatabase["scimToken"]["findFirst"]> {
    return this.database.scimToken.findFirst({ where: { hashedToken } });
  }

  async recordUse(tokenId: string, usedAt: Date): Promise<void> {
    await this.database.scimToken.updateMany({
      where: { id: tokenId },
      data: { lastUsedAt: usedAt },
    });
  }
}
