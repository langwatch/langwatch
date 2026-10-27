-- Phase 6's synthetic tenant set at the old schema: one organisation and team holding
-- :users users and :projects projects, every id prefixed rh_<run>_s. Spans at scale are
-- not seeded here (README, "Not covered yet"). Run by rehearse.sh with -v run, projects, users.
\set ON_ERROR_STOP on
SET search_path TO mydb;

BEGIN;

INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
VALUES ('rh_' || :'run' || '_s_org', 'Rehearsal scale', 'rh-' || :'run' || '-s-org', now(), now());

INSERT INTO "Team" (id, name, slug, "organizationId", "createdAt", "updatedAt", "isPersonal", "ownerUserId")
VALUES ('rh_' || :'run' || '_s_team', 'Scale team', 'rh-' || :'run' || '-s-team', 'rh_' || :'run' || '_s_org', now(), now(), false, NULL);

INSERT INTO "User" (id, name, email, "createdAt", "updatedAt", "lastLoginAt", "deactivatedAt")
SELECT 'rh_' || :'run' || '_s_u' || g, 'Scale user ' || g, 'scale' || g || '+' || :'run' || '@rehearsal.test',
       now(), now(), CASE WHEN g % 3 = 0 THEN NULL ELSE now() END, CASE WHEN g % 10 = 0 THEN now() END
FROM generate_series(1, :users) g;

INSERT INTO "OrganizationUser" ("userId", "organizationId", role, "createdAt", "updatedAt")
SELECT 'rh_' || :'run' || '_s_u' || g, 'rh_' || :'run' || '_s_org', CASE WHEN g = 1 THEN 'ADMIN' ELSE 'MEMBER' END::"OrganizationUserRole", now(), now()
FROM generate_series(1, :users) g;

INSERT INTO "Project" (id, name, slug, "apiKey", "teamId", language, framework, "createdAt", "updatedAt", "archivedAt", "isPersonal", "ownerUserId")
SELECT 'rh_' || :'run' || '_s_p' || g, 'Scale project ' || g, 'rh-' || :'run' || '-s-p' || g, 'sk-lw-rh' || :'run' || 's' || g,
       'rh_' || :'run' || '_s_team', 'python', 'openai', now(), now(), CASE WHEN g % 20 = 0 THEN now() END, false, NULL
FROM generate_series(1, :projects) g;

COMMIT;
