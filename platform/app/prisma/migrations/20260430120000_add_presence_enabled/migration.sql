-- Add `presenceEnabled` toggle on Organization and Project so multiplayer
-- presence can be turned off org-wide (and overridden per project).

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "presenceEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "presenceEnabled" BOOLEAN NOT NULL DEFAULT true;
