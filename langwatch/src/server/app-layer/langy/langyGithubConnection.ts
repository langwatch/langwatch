/**
 * Data-access layer for the Langy ↔ GitHub per-user connection
 * (UserGitHubCredential rows + organizationUser membership reads).
 *
 * Pulled out of the Hono route and the tRPC router so neither layer talks to
 * Prisma directly — both call through here. The route gets a `MembershipMissing`
 * sentinel (no transport-aware throws); the tRPC router maps that to its own
 * TRPCError at the boundary. Issue #4747.
 */
import type { PrismaClient } from "@prisma/client";

export type UpsertGithubCredentialInput = {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  githubLogin: string;
  githubUserId: string;
  encryptedRefreshToken: string;
  scopes: string | null;
};

export async function isOrganizationMember({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}): Promise<boolean> {
  const membership = await prisma.organizationUser.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return membership !== null;
}

export async function upsertGithubCredential({
  prisma,
  userId,
  organizationId,
  githubLogin,
  githubUserId,
  encryptedRefreshToken,
  scopes,
}: UpsertGithubCredentialInput): Promise<void> {
  await prisma.userGitHubCredential.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    create: {
      userId,
      organizationId,
      githubLogin,
      githubUserId,
      encryptedRefreshToken,
      scopes,
    },
    update: {
      githubLogin,
      githubUserId,
      encryptedRefreshToken,
      scopes,
    },
  });
}

export async function findGithubConnection({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}): Promise<{
  githubLogin: string;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  return prisma.userGitHubCredential.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: {
      githubLogin: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function deleteGithubConnection({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}): Promise<number> {
  const result = await prisma.userGitHubCredential.deleteMany({
    where: { userId, organizationId },
  });
  return result.count;
}
