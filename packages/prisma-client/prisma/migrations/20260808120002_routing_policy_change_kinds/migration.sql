-- IRREVERSIBLE: PostgreSQL cannot remove a value from an enum type. Undoing
-- this would mean recreating "GatewayChangeEventKind" and rewriting every
-- column that uses it, which is not safe against live data. Forward-only by
-- design, and harmless to leave in place: the added values are inert on any
-- build that does not emit them.
ALTER TYPE "GatewayChangeEventKind" ADD VALUE IF NOT EXISTS 'ROUTING_POLICY_UPDATED';
ALTER TYPE "GatewayChangeEventKind" ADD VALUE IF NOT EXISTS 'ROUTING_POLICY_DELETED';
