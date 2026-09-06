-- Org-level trace-sharing kill switch (ADR-039).
--
-- Mirrors `Organization.presenceEnabled`: the org toggle is the global switch,
-- the per-project `Project.traceSharingEnabled` scopes the kill to a single
-- project. Effective sharing = org AND project. Defaults to TRUE so existing
-- orgs keep the current (project-governed) behavior.
ALTER TABLE "Organization" ADD COLUMN "traceSharingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Down: (reversible — uncomment and run manually to roll back)
-- ALTER TABLE "Organization" DROP COLUMN "traceSharingEnabled";
