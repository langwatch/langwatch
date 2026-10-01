-- Phase 8: per-org max CLI session duration in days. 0 = unbounded
-- (default, mirrors GitHub CLI / gh-style flows). Positive values
-- enforce a finite session lifetime at /api/auth/cli/refresh — companies
-- with SOC 2 / ISO 27001-style mandated session expiry can set a value
-- via the admin org settings. See:
--   specs/ai-governance/sessions/session-ttl.feature
ALTER TABLE "Organization"
  ADD COLUMN "maxSessionDurationDays" INTEGER NOT NULL DEFAULT 0;
