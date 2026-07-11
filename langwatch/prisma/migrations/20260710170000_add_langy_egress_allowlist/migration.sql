-- Per-project Langy egress allow-list (ADR-043). Nullable JSON array of host
-- patterns the project's Langy workers may reach outbound. NULL/absent means
-- monitor-only (watch, never block); a non-empty array restricts egress to
-- floor ∪ this list at the agent pod's egress adapter. Additive, opt-in: an
-- existing project upgrades into watching, not blocking.
-- AlterTable
ALTER TABLE "Project" ADD COLUMN "langyEgressAllowlist" JSONB;
