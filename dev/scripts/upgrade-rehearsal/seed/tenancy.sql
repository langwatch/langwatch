-- Phase 0 tenancy at the old image's schema (3.20.1 and origin/main share these columns).
-- Run by rehearse.sh through psql with -v run=<id>; everything it writes is prefixed rh_<id>.
-- Organisations, teams and users are written here because the old image has no headless
-- surface that creates them; traces and spans then go through the old api (otlp-batch.mjs).
\set ON_ERROR_STOP on
SET search_path TO mydb;

BEGIN;

INSERT INTO "User" (id, name, email, "createdAt", "updatedAt", "lastLoginAt", "deactivatedAt") VALUES
  ('rh_' || :'run' || '_u_active', 'Rehearsal Active', 'active+' || :'run' || '@rehearsal.test', now(), now(), now(), NULL),
  ('rh_' || :'run' || '_u_deactivated', 'Rehearsal Deactivated', 'deactivated+' || :'run' || '@rehearsal.test', now(), now(), now(), now()),
  ('rh_' || :'run' || '_u_never', 'Rehearsal Never Signed In', 'never+' || :'run' || '@rehearsal.test', now(), now(), NULL, NULL);

INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES
  ('rh_' || :'run' || '_org_a', 'Rehearsal A', 'rh-' || :'run' || '-org-a', now(), now()),
  ('rh_' || :'run' || '_org_b', 'Rehearsal B', 'rh-' || :'run' || '-org-b', now(), now());

INSERT INTO "OrganizationUser" ("userId", "organizationId", role, "createdAt", "updatedAt") VALUES
  ('rh_' || :'run' || '_u_active', 'rh_' || :'run' || '_org_a', 'ADMIN', now(), now()),
  ('rh_' || :'run' || '_u_deactivated', 'rh_' || :'run' || '_org_a', 'MEMBER', now(), now()),
  ('rh_' || :'run' || '_u_never', 'rh_' || :'run' || '_org_a', 'MEMBER', now(), now()),
  ('rh_' || :'run' || '_u_active', 'rh_' || :'run' || '_org_b', 'ADMIN', now(), now());

INSERT INTO "Team" (id, name, slug, "organizationId", "createdAt", "updatedAt", "isPersonal", "ownerUserId") VALUES
  ('rh_' || :'run' || '_team_a', 'Team A', 'rh-' || :'run' || '-team-a', 'rh_' || :'run' || '_org_a', now(), now(), false, NULL),
  ('rh_' || :'run' || '_team_personal', 'Personal', 'rh-' || :'run' || '-team-personal', 'rh_' || :'run' || '_org_a', now(), now(), true, 'rh_' || :'run' || '_u_active'),
  ('rh_' || :'run' || '_team_b', 'Team B', 'rh-' || :'run' || '-team-b', 'rh_' || :'run' || '_org_b', now(), now(), false, NULL);

INSERT INTO "TeamUser" ("userId", "teamId", role, "createdAt", "updatedAt") VALUES
  ('rh_' || :'run' || '_u_active', 'rh_' || :'run' || '_team_a', 'ADMIN', now(), now()),
  ('rh_' || :'run' || '_u_never', 'rh_' || :'run' || '_team_a', 'MEMBER', now(), now()),
  ('rh_' || :'run' || '_u_active', 'rh_' || :'run' || '_team_personal', 'ADMIN', now(), now()),
  ('rh_' || :'run' || '_u_active', 'rh_' || :'run' || '_team_b', 'ADMIN', now(), now());

-- One project per shape: team, archived, personal, and one in a second organisation.
INSERT INTO "Project" (id, name, slug, "apiKey", "teamId", language, framework, "createdAt", "updatedAt", "archivedAt", "isPersonal", "ownerUserId") VALUES
  ('rh_' || :'run' || '_p_team', 'Team project', 'rh-' || :'run' || '-p-team', 'sk-lw-rh' || :'run' || 'team', 'rh_' || :'run' || '_team_a', 'python', 'openai', now(), now(), NULL, false, NULL),
  ('rh_' || :'run' || '_p_archived', 'Archived project', 'rh-' || :'run' || '-p-archived', 'sk-lw-rh' || :'run' || 'archived', 'rh_' || :'run' || '_team_a', 'python', 'openai', now(), now(), now(), false, NULL),
  ('rh_' || :'run' || '_p_personal', 'Personal project', 'rh-' || :'run' || '-p-personal', 'sk-lw-rh' || :'run' || 'personal', 'rh_' || :'run' || '_team_personal', 'typescript', 'vercel_ai', now(), now(), NULL, true, 'rh_' || :'run' || '_u_active'),
  ('rh_' || :'run' || '_p_org_b', 'Second organisation project', 'rh-' || :'run' || '-p-org-b', 'sk-lw-rh' || :'run' || 'orgb', 'rh_' || :'run' || '_team_b', 'python', 'langchain', now(), now(), NULL, false, NULL);

COMMIT;
