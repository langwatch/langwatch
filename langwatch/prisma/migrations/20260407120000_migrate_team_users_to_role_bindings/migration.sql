-- Migrate OrganizationUser → RoleBinding (ORGANIZATION-scoped)
--
-- For every OrganizationUser row that does not already have a matching
-- ORGANIZATION-scoped RoleBinding, insert one.  Idempotent.
--
-- EXTERNAL users are skipped: they are restricted by design and get access
-- only via team/project-scoped bindings.

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
  ou."organizationId",
  ou."userId",
  ou."role"::"TeamUserRole",
  NULL,
  'ORGANIZATION'::"RoleBindingScopeType",
  ou."organizationId",
  NOW(),
  NOW()
FROM "OrganizationUser" ou
WHERE ou."role" != 'EXTERNAL'
  AND NOT EXISTS (
    SELECT 1
    FROM "RoleBinding" rb
    WHERE rb."organizationId" = ou."organizationId"
      AND rb."userId"         = ou."userId"
      AND rb."scopeType"      = 'ORGANIZATION'::"RoleBindingScopeType"
      AND rb."scopeId"        = ou."organizationId"
  );

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
