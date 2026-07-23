-- Scopes Langy's minted GitHub installation tokens to a project's bound repo
-- instead of the whole installation (issue #790). Null means no repo is
-- bound yet, so tokens fall back to full-installation scope. See
-- LangyGithubInstallationsService.mintTurnToken.
ALTER TABLE "Project" ADD COLUMN "repositoryFullName" TEXT;
