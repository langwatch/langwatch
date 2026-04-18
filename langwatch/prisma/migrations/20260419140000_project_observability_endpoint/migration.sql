-- AI Gateway: per-project OTLP endpoint (contract §4.2 observability_endpoint).
-- Nullable; null means the gateway falls back to GATEWAY_OTEL_DEFAULT_ENDPOINT.
ALTER TABLE "Project" ADD COLUMN "observabilityEndpoint" TEXT;
