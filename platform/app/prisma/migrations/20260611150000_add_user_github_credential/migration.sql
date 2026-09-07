-- Per-user GitHub App connection used by Langy to open pull requests
-- attributed to the requesting user. Stores ONLY the encrypted refresh token
-- (long-lived but rotating); access tokens (8h TTL) are minted on demand and
-- never persisted. Scoped by (userId, organizationId): a user in two orgs
-- connects twice so the installation context stays org-bounded.
-- Issue: #4747. Spec: specs/assistant/langy-github-prs.feature.

-- CreateTable
CREATE TABLE "UserGitHubCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "scopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGitHubCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserGitHubCredential_userId_organizationId_key" ON "UserGitHubCredential"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "UserGitHubCredential_organizationId_idx" ON "UserGitHubCredential"("organizationId");

-- Foreign keys intentionally omitted — referential integrity is handled by
-- Prisma's @relation directives (User, Organization). The codebase convention
-- is no DB-level FOREIGN KEY constraints in migrations.
