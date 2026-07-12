import type { PrismaClient } from "@prisma/client";

import {
  type LangyGithubConnection,
  type LangyGithubCredentialRow,
  type LangyUserGithubCredentialsRepository,
  type UpsertLangyGithubCredentialInput,
} from "./langy-user-github-credentials.repository";

export class PrismaLangyUserGithubCredentialsRepository
  implements LangyUserGithubCredentialsRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findCredential({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LangyGithubCredentialRow | null> {
    return this.prisma.userGitHubCredential.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { encryptedRefreshToken: true, githubLogin: true },
    });
  }

  async findConnection({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LangyGithubConnection | null> {
    return this.prisma.userGitHubCredential.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { githubLogin: true, createdAt: true, updatedAt: true },
    });
  }

  async upsert({
    userId,
    organizationId,
    githubLogin,
    githubUserId,
    encryptedRefreshToken,
    scopes,
  }: UpsertLangyGithubCredentialInput): Promise<void> {
    await this.prisma.userGitHubCredential.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      create: {
        userId,
        organizationId,
        githubLogin,
        githubUserId,
        encryptedRefreshToken,
        scopes,
      },
      update: { githubLogin, githubUserId, encryptedRefreshToken, scopes },
    });
  }

  async updateRefreshToken({
    userId,
    organizationId,
    encryptedRefreshToken,
  }: {
    userId: string;
    organizationId: string;
    encryptedRefreshToken: string;
  }): Promise<void> {
    await this.prisma.userGitHubCredential.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { encryptedRefreshToken },
    });
  }

  async deleteByUserOrg({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<number> {
    const result = await this.prisma.userGitHubCredential.deleteMany({
      where: { userId, organizationId },
    });
    return result.count;
  }

  async isOrganizationMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    return membership !== null;
  }

  async findFirstAdminUserId(organizationId: string): Promise<string | null> {
    const admin = await this.prisma.organizationUser.findFirst({
      where: { organizationId, role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    return admin?.userId ?? null;
  }
}
