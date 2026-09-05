-- The domains whose published record stayed missing through its grace window
-- (ADR-123). A column of its own rather than a read over `domainVerifications`
-- because the two questions that consult it - "may this person be provisioned
-- on first sign-in" and "may this person walk in by domain" - are asked on a
-- sign-in path, and folding a JSON array per request to answer them is not a
-- thing a sign-in can afford.
--
-- It is a SUBSET of `verifiedDomains`, never a replacement for it. A lapsed
-- domain still routes: everyone already at that company signs in exactly as
-- before, the connection stays ACTIVE, and what stops is only the vouching for
-- somebody new. Backfilling anything would be wrong - no existing row has ever
-- been re-checked, so every one of them starts with nothing lapsed, which is
-- what the empty default says.
ALTER TABLE "SsoConnection" ADD COLUMN "lapsedDomains" TEXT[];

CREATE INDEX "SsoConnection_lapsedDomains_idx" ON "SsoConnection" USING GIN ("lapsedDomains");
