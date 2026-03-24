import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Manages SCIM bearer tokens: generation, hashing, and verification.
 * Each token is scoped to a single organization.
 */
export class ScimTokenService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimTokenService {
    return new ScimTokenService(prisma);
  }

  /**
   * Generates a new SCIM token for the given organization.
   * Returns the plaintext token (shown once) and stores the SHA-256 hash.
   */
  async generate({
    organizationId,
    description,
  }: {
    organizationId: string;
    description?: string;
  }): Promise<{ token: string; tokenId: string }> {
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = this.hashToken(token);

    const scimToken = await this.prisma.scimToken.create({
      data: {
        organizationId,
        hashedToken,
        description: description ?? null,
      },
    });

    return { token, tokenId: scimToken.id };
  }

  /**
   * Verifies a bearer token and returns the associated organization ID.
   * Updates lastUsedAt on successful verification.
   */
  async verify({
    token,
  }: {
    token: string;
  }): Promise<{ organizationId: string } | null> {
    const hashedToken = this.hashToken(token);

    const scimToken = await this.prisma.scimToken.findFirst({
      where: { hashedToken },
    });

    if (!scimToken) {
      return null;
    }

    await this.prisma.scimToken.update({
      where: { id: scimToken.id },
      data: { lastUsedAt: new Date() },
    });

    return { organizationId: scimToken.organizationId };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
