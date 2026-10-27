-- RoutingPolicy gains two JSON columns hoisted from per-VK config:
-- modelAliases (name -> name rewrites) and policyRules (deny/allow lists
-- per tools/mcp/urls/models dimension).
--
-- Rationale: per-VK config caused configuration drift (every new VK
-- needed the same aliases + deny lists re-typed). Moving these onto the
-- RoutingPolicy lets a single edit propagate to every VK linked to
-- that policy. The gateway resolver merges policy-level aliases/rules
-- onto the bundle at materialise time — Go-side consumes the same
-- shape, the source just moved upstream.
--
-- Defaults are empty JSON objects so existing rows on dev/prod continue
-- to render without explicit migration data; the (iv) backfill walk
-- handles populating these from per-VK config for any VK that had
-- non-empty aliases/rules.
--
-- Forward-only. Down migration would be DROP COLUMN modelAliases +
-- DROP COLUMN policyRules; commented out per CLAUDE.md convention.

ALTER TABLE "RoutingPolicy"
  ADD COLUMN "modelAliases" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "policyRules" JSONB NOT NULL DEFAULT '{}'::jsonb;
