-- The model a reserved tier name (complex / reasoning / fast) resolves to
-- when a routing policy names no target of its own for that tier.
--
-- Nullable with no default: a policy that has never been edited for tiers
-- has no opinion about them, and an invented default would start answering
-- tier requests with a model nobody chose.
-- To roll back, uncomment and run manually. Dropping the column discards every
-- default model an operator configured, and the tiers that fell through to it
-- stop resolving on the next config materialization.
-- ALTER TABLE "RoutingPolicy" DROP COLUMN "defaultModel";

ALTER TABLE "RoutingPolicy" ADD COLUMN "defaultModel" TEXT;
