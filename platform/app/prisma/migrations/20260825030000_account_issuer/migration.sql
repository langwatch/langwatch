-- better-auth 1.7: an account is identified by `(issuer, accountId)`.
--
-- 1.7 re-keyed the account model. Where it used to find a row by
-- `(providerId, accountId)` it now finds it by `(issuer, accountId)`, and
-- `issuer` is a REQUIRED field with no default. We had no such column, and
-- better-auth's own field mapping named none, so the value it looks up had
-- nowhere to live.
--
-- That is not a cosmetic gap. `findCredentialAccount` filters on
-- `issuer = 'local:credential'` alongside the provider id, and email sign-in
-- checks the same thing in memory over the joined account list. A row with no
-- issuer fails the filter, better-auth reports no credential account, and the
-- customer is told "invalid email or password" for a password that is
-- perfectly correct. Every user is on this path today: the identity write
-- gate ships closed, so the legacy branch is the only branch anyone is on.
--
-- WHAT EACH EXISTING ROW GETS
--
-- The value has to be the one better-auth will ASK for, or the row may as
-- well not carry it. Three cases, and the third is why the application had to
-- change in the same commit:
--
--   * `credential` -> 'local:credential'. better-auth synthesises this for
--     internal methods as `local:<providerId>` - note it is NOT the
--     `local:oauth:` namespace, which is for social providers only.
--
--   * `google` -> 'https://accounts.google.com'. Google is one of the few
--     built-in social providers that declares a real issuer, and it is
--     hardcoded in the provider itself - not overridable from our config -
--     so this constant is exactly what 1.7 will look up.
--
--   * everything else -> `local:oauth:<provider>`, the synthetic namespace
--     better-auth uses for a provider that declares no issuer of its own.
--     True as shipped for github and gitlab. For the generic-OAuth providers
--     (auth0, okta, cognito, onelogin, oidc) it is true because
--     `buildGenericOAuthConfigs` now PINS `accountIssuer` to this same value:
--     left unpinned they would adopt the issuer from OIDC discovery, and
--     every existing enterprise account would become unfindable under a key
--     no stored row carries. The pin and this backfill are one decision, and
--     neither is correct without the other.
--
-- KNOWN EXCEPTION: `microsoft` (a deployment running NEXTAUTH_PROVIDER=
-- azure-ad). better-auth resolves that provider's issuer from the token
-- itself - `profile.iss`, which is per-tenant - and, like google, it is
-- hardcoded rather than configurable, so neither this migration nor the app
-- can pin it. Those rows are backfilled to the synthetic form so the column
-- is never null, and an azure-ad deployment must correct them to its own
-- tenant issuer:
--
--   UPDATE "Account" SET "issuer" = 'https://login.microsoftonline.com/<tenant-id>/v2.0'
--   WHERE "provider" = 'microsoft';
--
-- No LangWatch-operated deployment uses azure-ad; it is a self-hosting
-- option, which is why this ships as a documented follow-up rather than
-- blocking the fix everyone else needs.
--
-- NULLABLE ON PURPOSE. better-auth declares the field required, and its own
-- migrator refuses to add a required, default-less column to a populated
-- table precisely because the existing rows would be silently filled with
-- garbage. The column is added nullable, backfilled here, and every write
-- path supplies it; tightening it to NOT NULL is a later migration once the
-- backfill is proven in production.
--
-- NO UNIQUE INDEX ON (issuer, accountId) YET, and deliberately. better-auth
-- declares that uniqueness in its schema, but our `Account` is already unique
-- on `(provider, providerAccountId)` and the values written here are derived
-- from `provider`, so the new pair is unique exactly when the old one is.
-- Adding the index would be redundant today and would fail the migration
-- outright on any deployment whose azure-ad rows have not been corrected.
--
-- To roll back, uncomment and run manually. The column is additive and
-- nothing outside better-auth's account key reads it.
-- ALTER TABLE "Account" DROP COLUMN "issuer";
-- ALTER TABLE "Identifier" DROP COLUMN "issuer";

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "issuer" TEXT;

-- Backfill every existing row. Ordered CASE: the specific providers first,
-- the synthetic namespace as the catch-all.
UPDATE "Account"
SET "issuer" = CASE
    WHEN "provider" = 'credential' THEN 'local:credential'
    WHEN "provider" = 'google' THEN 'https://accounts.google.com'
    ELSE 'local:oauth:' || "provider"
  END
WHERE "issuer" IS NULL;

-- Reaches a row by the key better-auth 1.7 actually looks it up by.
-- CreateIndex
CREATE INDEX "Account_issuer_providerAccountId_idx" ON "Account"("issuer", "providerAccountId");

-- ADR-116/ADR-101: the same fact on the event log's own projection.
--
-- `Account` is a projection of the identity log, so the fold has to be able
-- to REPRODUCE the column above rather than compute it at write time - and it
-- cannot compute it, because a real OIDC issuer is not derivable from
-- anything else the identifier holds. `identifier_attached` therefore states
-- the issuer better-auth itself decided, the identifier carries it, and the
-- fold projects it.
--
-- Safe to state now rather than later: the write gate ships closed, so no
-- identity event has ever been emitted and there is no history to re-state.
-- That window closes the moment anyone is enrolled.

-- AlterTable
ALTER TABLE "Identifier" ADD COLUMN "issuer" TEXT;

-- Seed from the rows the identifiers were adopted from, exactly as the
-- `providerAccountId` backfill did, so a user the backfill has already
-- adopted does not wait for their next pass. A user it has not reached has no
-- identifiers and is filled in when it does.
UPDATE "Identifier" i
SET "issuer" = a."issuer"
FROM "Account" a
WHERE i."accountId" = a."id"
  AND i."issuer" IS NULL;

-- Answers an IdP callback's `(issuer, subject)` lookup on the projection.
-- CreateIndex
CREATE INDEX "Identifier_issuer_providerAccountId_idx" ON "Identifier"("issuer", "providerAccountId");
