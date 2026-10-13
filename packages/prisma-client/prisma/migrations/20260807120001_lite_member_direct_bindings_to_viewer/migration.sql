-- A Lite Member seat means viewing only, and the stored access rows now say
-- so too: direct rows are enforced at write time, so rows written before that
-- rule are corrected here. Effective access does not change for anyone --
-- resolution already capped every non-custom row on a Lite Member seat to
-- Viewer and skipped their organization-scoped rows entirely, so this sweep
-- only makes the stored rows tell the truth the cap was already enforcing.
--
-- What is deliberately left alone:
--   * Custom-role rows ("customRoleId" IS NOT NULL): grandfathered delegation,
--     honored at runtime and billed as a full seat; the member's next seat
--     change clears them, a sweep must not.
--   * Personal-workspace rows (teams and projects with "isPersonal" = true):
--     the stored owner role plus the runtime cap is what makes re-promoting
--     the member restore their workspace untouched.
--   * Group-scoped rows: the binding belongs to the group, not the member.
--
-- Order matters: the partial unique index "RoleBinding_user_builtin_role_scope_key"
-- keys on (userId, role, scopeType, scopeId), so rows are deleted first wherever
-- updating them to VIEWER would collide -- either with a Viewer row the member
-- already holds on that scope, or with each other when one member holds several
-- above-Viewer rows on the same scope (the oldest row survives to be updated).

-- 1. Delete above-Viewer rows whose correction would collide.
WITH affected AS (
  SELECT
    rb."id",
    ROW_NUMBER() OVER (
      PARTITION BY rb."userId", rb."scopeType", rb."scopeId"
      ORDER BY rb."createdAt", rb."id"
    ) AS keep_rank,
    EXISTS (
      SELECT 1
      FROM "RoleBinding" v
      WHERE v."userId" = rb."userId"
        AND v."customRoleId" IS NULL
        AND v."role" = 'VIEWER'
        AND v."scopeType" = rb."scopeType"
        AND v."scopeId" = rb."scopeId"
    ) AS has_viewer_row
  FROM "RoleBinding" rb
  JOIN "OrganizationUser" ou
    ON ou."organizationId" = rb."organizationId"
   AND ou."userId" = rb."userId"
  LEFT JOIN "Team" t
    ON rb."scopeType" = 'TEAM' AND t."id" = rb."scopeId"
  LEFT JOIN "Project" p
    ON rb."scopeType" = 'PROJECT' AND p."id" = rb."scopeId"
  LEFT JOIN "Team" pt
    ON pt."id" = p."teamId"
  WHERE ou."role" = 'EXTERNAL'
    AND rb."customRoleId" IS NULL
    AND rb."role" <> 'VIEWER'
    AND (
      (rb."scopeType" = 'TEAM' AND t."isPersonal" = false)
      OR (rb."scopeType" = 'PROJECT' AND p."isPersonal" = false AND pt."isPersonal" = false)
    )
)
DELETE FROM "RoleBinding"
WHERE "id" IN (
  SELECT "id" FROM affected WHERE keep_rank > 1 OR has_viewer_row
);

-- 2. Correct the surviving above-Viewer TEAM rows on shared teams.
UPDATE "RoleBinding" rb
SET "role" = 'VIEWER', "updatedAt" = now()
FROM "OrganizationUser" ou
WHERE ou."organizationId" = rb."organizationId"
  AND ou."userId" = rb."userId"
  AND ou."role" = 'EXTERNAL'
  AND rb."customRoleId" IS NULL
  AND rb."role" <> 'VIEWER'
  AND rb."scopeType" = 'TEAM'
  AND EXISTS (
    SELECT 1 FROM "Team" t
    WHERE t."id" = rb."scopeId" AND t."isPersonal" = false
  );

-- 3. Correct the surviving above-Viewer PROJECT rows on shared projects.
UPDATE "RoleBinding" rb
SET "role" = 'VIEWER', "updatedAt" = now()
FROM "OrganizationUser" ou
WHERE ou."organizationId" = rb."organizationId"
  AND ou."userId" = rb."userId"
  AND ou."role" = 'EXTERNAL'
  AND rb."customRoleId" IS NULL
  AND rb."role" <> 'VIEWER'
  AND rb."scopeType" = 'PROJECT'
  AND EXISTS (
    SELECT 1
    FROM "Project" p
    JOIN "Team" t ON t."id" = p."teamId"
    WHERE p."id" = rb."scopeId"
      AND p."isPersonal" = false
      AND t."isPersonal" = false
  );

-- 4. Delete non-custom organization-scoped rows for Lite Members. Resolution
-- skips them entirely on this seat, and the seat-change cascade deletes them,
-- so any still stored are dead weight from before write-time enforcement.
DELETE FROM "RoleBinding" rb
USING "OrganizationUser" ou
WHERE ou."organizationId" = rb."organizationId"
  AND ou."userId" = rb."userId"
  AND ou."role" = 'EXTERNAL'
  AND rb."customRoleId" IS NULL
  AND rb."scopeType" = 'ORGANIZATION';
