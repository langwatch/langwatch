-- Experiments became their own RBAC permission (experiments:view /
-- experiments:manage) instead of inheriting workflows:view. Built-in roles
-- (ADMIN / MEMBER / VIEWER / ...) pick up the new permission from code. Custom
-- roles store their grants as a JSONB array of "resource:action" strings, so
-- grant the matching experiments permission to every custom role that already
-- holds the corresponding workflows permission. This keeps existing custom
-- roles and PAT-backed system roles working exactly as before; going forward an
-- admin can grant experiments access without granting workflows access.
--
-- Idempotent: each statement skips roles that already carry the new permission.

UPDATE "CustomRole"
SET "permissions" = "permissions" || '["experiments:view"]'::jsonb
WHERE "permissions" @> '["workflows:view"]'::jsonb
  AND NOT ("permissions" @> '["experiments:view"]'::jsonb);

UPDATE "CustomRole"
SET "permissions" = "permissions" || '["experiments:manage"]'::jsonb
WHERE "permissions" @> '["workflows:manage"]'::jsonb
  AND NOT ("permissions" @> '["experiments:manage"]'::jsonb);
