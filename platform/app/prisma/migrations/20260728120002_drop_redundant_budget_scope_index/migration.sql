-- The (scopeType, scopeId) index is a leftmost prefix of
-- (scopeType, scopeId, providerKey), so every lookup it served is served
-- by the wider index and keeping both only adds write and storage cost.
-- Two names covered: the original migration named it "GatewayBudget_scope_idx",
-- while installs recreated from the schema carry Prisma's default name.
DROP INDEX IF EXISTS "GatewayBudget_scope_idx";
DROP INDEX IF EXISTS "GatewayBudget_scopeType_scopeId_idx";
