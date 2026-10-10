-- ADR-116: the provider's own id and subject, on the projection.
--
-- `Account` is demoted from a source of truth to a projection of the event
-- log, alongside `Identifier` - the fold owns its linkage columns and
-- better-auth reads it with the stock adapter. For the fold to reproduce
-- `Account.providerAccountId` the identifier has to carry it, and it did
-- not: the subject was already an input to the derived identifier id, but
-- was never stated on the fact.
--
-- Safe to add now rather than later: the write gate ships closed, so no
-- identity event has ever been emitted and there is no history to re-state.
-- That window closes the moment anyone is enrolled.
--
-- The same holds for `providerId`, and for the same reason one layer over:
-- `Identifier.provider` is the FOLDED identifier vocabulary, which collapses
-- auth0, okta and every custom OIDC connection into `oidc` and microsoft into
-- `azure-ad`. better-auth queries `Account` by its OWN provider id, so a fold
-- that wrote the folded name would break the very lookup `Account` exists to
-- answer. The identifier therefore carries better-auth's id verbatim as well.
--
-- To roll back, uncomment and run manually. Both columns are additive and
-- nothing outside identity reads them.
-- ALTER TABLE "Identifier" DROP COLUMN "providerAccountId";
-- ALTER TABLE "Identifier" DROP COLUMN "providerId";

-- AlterTable
ALTER TABLE "Identifier" ADD COLUMN "providerAccountId" TEXT;

-- AlterTable
ALTER TABLE "Identifier" ADD COLUMN "providerId" TEXT;

-- Answers an IdP callback's `(provider, subject)` lookup.
-- CreateIndex
CREATE INDEX "Identifier_provider_providerAccountId_idx" ON "Identifier"("provider", "providerAccountId");

-- Reaches the `Account` row an identifier projects to.
-- CreateIndex
CREATE INDEX "Identifier_accountId_idx" ON "Identifier"("accountId");

-- Seed from the rows the identifiers were adopted from, so a user the
-- backfill has already adopted does not wait for their next pass. A user the
-- backfill has not reached has no identifiers and is filled in when it
-- reaches them.
UPDATE "Identifier" i
SET "providerAccountId" = a."providerAccountId",
    "providerId" = a."provider"
FROM "Account" a
WHERE i."accountId" = a."id"
  AND (i."providerAccountId" IS NULL OR i."providerId" IS NULL);
