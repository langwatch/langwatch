-- The account a connection reads, as the provider itself named it.
--
-- Read once per save and compared so two connections cannot report one
-- account's spend twice. Nullable: every connection that predates the guard
-- has none, and the source types that name what they read in their own config
-- (Azure by subscription, Power Platform by environment) never carry one.
ALTER TABLE "IngestionSource" ADD COLUMN "providerAccountId" TEXT;
