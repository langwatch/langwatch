-- Who owns a proved domain, as a row the database can refuse twice.
--
-- "First verifier owns" was a read-then-write: `findDomainOwner` asked
-- whether anybody held the domain, and the caller then appended the fact on
-- its OWN aggregate. Two different aggregates, so the per-connection queue
-- never ordered them against each other — and `SsoConnection.verifiedDomains`
-- is a `String[]` carrying only a GIN index, which enforces nothing at all.
-- Two organizations proving `acme.com` in the same moment both read "nobody
-- owns it" and both committed. The sign-in router then chose between two live
-- connections by planner order, so a member of one company could be sent to
-- another company's identity provider, and with `arrivalPolicy = 'admit'`
-- provisioned into it.
--
-- The legacy single-domain model HAD this guarantee: `Organization.ssoDomain`
-- is unique. The multi-domain rewrite dropped it, and making domain proof
-- self-serve is what turned the window from "two operators working at once"
-- into something a customer can drive.
--
-- SAFE TO RUN. The backfill takes the domains already proved. Where two rows
-- somehow already claim one, `DISTINCT ON` keeps the connection that proved
-- it first, which is the rule this table exists to enforce — so the index
-- build cannot fail on existing data, and any pre-existing collision is
-- resolved the way the invariant says it should have been.
--
-- To roll back, uncomment and run manually. Dropping the table loses only the
-- enforcement; `verifiedDomains` still holds the same domains.
-- DROP TABLE "SsoVerifiedDomain";

CREATE TABLE "SsoVerifiedDomain" (
    "domain" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "SsoVerifiedDomain_pkey" PRIMARY KEY ("domain")
);

CREATE INDEX "SsoVerifiedDomain_connectionId_idx" ON "SsoVerifiedDomain"("connectionId");
CREATE INDEX "SsoVerifiedDomain_organizationId_idx" ON "SsoVerifiedDomain"("organizationId");

-- First verifier owns, so oldest connection wins where a domain is held twice.
INSERT INTO "SsoVerifiedDomain" ("domain", "connectionId", "organizationId")
SELECT DISTINCT ON (domain) domain, "id", "organizationId"
FROM (
  SELECT "id", "organizationId", "createdAt", unnest("verifiedDomains") AS domain
  FROM "SsoConnection"
  WHERE "state" NOT IN ('DISCARDED', 'TORN_DOWN')
) AS held
ORDER BY domain, "createdAt" ASC;
