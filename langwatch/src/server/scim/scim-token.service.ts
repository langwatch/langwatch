import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { ScimTokenRepository } from "./scim-token.repository";

export class ScimTokenService {
  private readonly repository: ScimTokenRepository;

  constructor(prisma: PrismaClient) {
    this.repository = ScimTokenRepository.create(prisma);
  }

  static create(prisma: PrismaClient): ScimTokenService {
    return new ScimTokenService(prisma);
  }

  async generate({
    organizationId,
    description,
  }: {
    organizationId: string;
    description?: string;
  }): Promise<{ token: string; tokenId: string }> {
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = this.hashToken(token);

    const scimToken = await this.repository.create({
      organizationId,
      hashedToken,
      description: description ?? null,
    });

    return { token, tokenId: scimToken.id };
  }

  async verify({
    token,
  }: {
    token: string;
  }): Promise<{ organizationId: string } | null> {
    const hashedToken = this.hashToken(token);

    const scimToken = await this.repository.findByHashedToken({ hashedToken });

    if (!scimToken) {
      return null;
    }

    await this.repository.updateLastUsed({ id: scimToken.id });

    return { organizationId: scimToken.organizationId };
  }

  async listByOrganization({
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
    return this.repository.findAllByOrganization({ organizationId });
  }

  async revoke({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    return this.repository.delete({ id, organizationId });
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
