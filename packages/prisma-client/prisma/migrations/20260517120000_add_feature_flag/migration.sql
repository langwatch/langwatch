-- Postgres-backed value store for the in-code feature flag registry.
-- Owns only operator-set values for SYSTEM-scoped flags (and the rare
-- PRODUCT-flag override when PostHog is unreachable). Absence of a row
-- means "use the registry default": we don't seed the table.
CREATE TABLE "FeatureFlag" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "lastEditedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);
