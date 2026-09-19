-- Connected self-hosted (ADR-139): which hosted services an organization has
-- switched on.
--
-- Additive only: one array column defaulting to empty, so every existing
-- organization keeps sending nothing until an admin switches a service on.

ALTER TABLE "Organization" ADD COLUMN "connectServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
