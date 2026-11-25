-- IRREVERSIBLE: rolling this back means dropping "parentApiKeyId", which
-- erases which CLI login key each ingestion key was minted under. That link is
-- what makes logout, a devices-tab revoke, a re-login and session expiry retire
-- the ingestion keys of exactly one session, so once it is gone the surviving
-- keys can no longer be attributed to a session and the cascade cannot be
-- rebuilt from any other column. Prisma runs migrations forward only; to roll
-- back, run `ALTER TABLE "ApiKey" DROP COLUMN "parentApiKeyId";` by hand and
-- accept the loss.

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "parentApiKeyId" TEXT;
