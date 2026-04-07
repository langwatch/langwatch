-- Migrate TeamUser → RoleBinding (TEAM-scoped)
--
-- For every TeamUser row that does not already have a matching RoleBinding,
-- insert a new TEAM-scoped RoleBinding.  Idempotent: the WHERE NOT EXISTS
-- guard means re-running this migration is safe.
--
-- customRoleId is only copied when role = 'CUSTOM'; otherwise it is left NULL.

INSERT INTO "RoleBinding" (
  "id",
  "organizationId",
  "userId",
  "role",
  "customRoleId",
  "scopeType",
  "scopeId",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  t."organizationId",
  tu."userId",
  tu."role",
  CASE WHEN tu."role" = 'CUSTOM' THEN tu."assignedRoleId" ELSE NULL END,
  'TEAM'::"RoleBindingScopeType",
  tu."teamId",
  NOW(),
  NOW()
FROM "TeamUser" tu
JOIN "Team" t ON t."id" = tu."teamId"
WHERE NOT EXISTS (
  SELECT 1
  FROM "RoleBinding" rb
  WHERE rb."organizationId" = t."organizationId"
    AND rb."userId"         = tu."userId"
    AND rb."scopeType"      = 'TEAM'::"RoleBindingScopeType"
    AND rb."scopeId"        = tu."teamId"
);
