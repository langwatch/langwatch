-- The customer-facing trace the mint was recorded under, so the settlement can
-- write its cost back into that trace rather than starting a second one.
-- Nullable: sessions minted before this column exists have no trace to join,
-- and a mint that carried no trace context still books normally.
ALTER TABLE "GatewayRealtimeSession" ADD COLUMN "traceId" TEXT;
