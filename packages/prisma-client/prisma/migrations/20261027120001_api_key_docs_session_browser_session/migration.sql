-- ADR-185: the browser session that minted a docs session key, so signing out revokes it.
-- Nullable and unindexed: sign-out looks keys up by the indexed "userId" first.
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "createdByBrowserSessionId" TEXT;
