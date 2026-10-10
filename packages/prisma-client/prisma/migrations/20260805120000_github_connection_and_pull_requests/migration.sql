-- The GitHub App installation is the organization's GitHub connection, not
-- Langy's: rename the table (and every constraint/index Prisma derives from the
-- model name) and add the pull-request mapping the read path stores.
--
-- The rename is name-only, no data moves. The datasource runs
-- relationMode="prisma", so the organization relations carry no SQL foreign
-- key: there is none to rename on the installation table and none to create on
-- the new ones. Cascade on organization delete is emulated by the client.

-- RenameTable
ALTER TABLE "LangyGithubInstallation" RENAME TO "GithubInstallation";

-- RenameConstraint
ALTER TABLE "GithubInstallation" RENAME CONSTRAINT "LangyGithubInstallation_pkey" TO "GithubInstallation_pkey";

-- RenameIndex
ALTER INDEX "LangyGithubInstallation_installationId_key" RENAME TO "GithubInstallation_installationId_key";

-- RenameIndex
ALTER INDEX "LangyGithubInstallation_organizationId_idx" RENAME TO "GithubInstallation_organizationId_idx";

-- CreateTable
CREATE TABLE "GithubPullRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryHost" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "authorLogin" TEXT,
    "prCreatedAt" TIMESTAMP(3) NOT NULL,
    "prClosedAt" TIMESTAMP(3),
    "prMergedAt" TIMESTAMP(3),
    "mappedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubBranchPullRequestCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryHost" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "prCount" INTEGER NOT NULL DEFAULT 0,
    "notFoundAt" TIMESTAMP(3),
    "recheckAfter" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastRequestedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubBranchPullRequestCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubPullRequest_organizationId_repositoryHost_repositoryF_key" ON "GithubPullRequest"("organizationId", "repositoryHost", "repositoryFullName", "prNumber");

-- CreateIndex
CREATE INDEX "GithubPullRequest_organizationId_repositoryHost_repositoryF_idx" ON "GithubPullRequest"("organizationId", "repositoryHost", "repositoryFullName", "headBranch");

-- CreateIndex
CREATE UNIQUE INDEX "GithubBranchPullRequestCheck_organizationId_repositoryHost__key" ON "GithubBranchPullRequestCheck"("organizationId", "repositoryHost", "repositoryFullName", "headBranch");

-- CreateIndex
CREATE INDEX "GithubBranchPullRequestCheck_organizationId_notFoundAt_rech_idx" ON "GithubBranchPullRequestCheck"("organizationId", "notFoundAt", "recheckAfter");

-- Down (manual): reverses this migration; run only to roll back.
--   DROP TABLE "GithubBranchPullRequestCheck";
--   DROP TABLE "GithubPullRequest";
--   ALTER INDEX "GithubInstallation_organizationId_idx" RENAME TO "LangyGithubInstallation_organizationId_idx";
--   ALTER INDEX "GithubInstallation_installationId_key" RENAME TO "LangyGithubInstallation_installationId_key";
--   ALTER TABLE "GithubInstallation" RENAME CONSTRAINT "GithubInstallation_pkey" TO "LangyGithubInstallation_pkey";
--   ALTER TABLE "GithubInstallation" RENAME TO "LangyGithubInstallation";
