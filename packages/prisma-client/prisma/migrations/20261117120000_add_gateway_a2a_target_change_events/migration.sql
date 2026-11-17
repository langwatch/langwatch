-- Gateway change feed kinds for A2A target writes, so gateways refetch bundles.
ALTER TYPE "GatewayChangeEventKind" ADD VALUE IF NOT EXISTS 'A2A_TARGET_CREATED';
ALTER TYPE "GatewayChangeEventKind" ADD VALUE IF NOT EXISTS 'A2A_TARGET_UPDATED';
ALTER TYPE "GatewayChangeEventKind" ADD VALUE IF NOT EXISTS 'A2A_TARGET_DELETED';
