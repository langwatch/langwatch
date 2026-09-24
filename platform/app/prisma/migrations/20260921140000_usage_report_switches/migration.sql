-- IRREVERSIBLE: no down step. Dropping these loses a customer's decision to
-- switch part of the usage report off, and the next release would read the
-- default, which is on. A customer who opted out would be opted back in
-- without being asked, which is the specific thing this switch exists to
-- prevent. Rolling the code back alone is safe: the columns stay unread.
--
-- Connected self-hosted (ADR-139, section 10): the two switches on the usage
-- report. The optional category as a whole, and hostname on its own because it
-- names the customer's network.
--
-- Additive only: two booleans, both defaulting to the behaviour that ships.

ALTER TABLE "InstanceIdentity" ADD COLUMN "optionalMetricsOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InstanceIdentity" ADD COLUMN "hostnameOptOut" BOOLEAN NOT NULL DEFAULT false;
