-- Step 1: Add tagId column as nullable
ALTER TABLE "PromptTagAssignment" ADD COLUMN "tagId" TEXT;

-- Step 2: Auto-create missing PromptTag rows for any orphan assignments
-- (assignments whose tag name has no matching PromptTag in the org)
INSERT INTO "PromptTag" ("id", "organizationId", "name", "createdAt", "updatedAt")
SELECT
  'ptag_' || gen_random_uuid()::text,
  t."organizationId",
  a."tag",
  NOW(),
  NOW()
FROM "PromptTagAssignment" a
JOIN "Project" p ON p.id = a."projectId"
JOIN "Team" t ON t.id = p."teamId"
WHERE NOT EXISTS (
  SELECT 1 FROM "PromptTag" pt
  WHERE pt."organizationId" = t."organizationId" AND pt.name = a.tag
)
GROUP BY t."organizationId", a."tag";

-- Step 3: Backfill tagId from matching PromptTag rows
UPDATE "PromptTagAssignment" a
SET "tagId" = pt.id
FROM "Project" p, "Team" t, "PromptTag" pt
WHERE a."projectId" = p.id
  AND p."teamId" = t.id
  AND pt."organizationId" = t."organizationId"
  AND pt.name = a.tag;

-- Step 4: Set tagId NOT NULL
ALTER TABLE "PromptTagAssignment" ALTER COLUMN "tagId" SET NOT NULL;

-- Step 5: Drop old unique constraint (must happen before dropping column, as PG
-- auto-drops constraints on column drop and the explicit DROP would then fail)
ALTER TABLE "PromptTagAssignment" DROP CONSTRAINT IF EXISTS "PromptTagAssignment_configId_tag_key";

-- Step 6: Drop the old tag column
ALTER TABLE "PromptTagAssignment" DROP COLUMN "tag";

-- Step 7: Add FK constraint and new unique constraint
ALTER TABLE "PromptTagAssignment" ADD CONSTRAINT "PromptTagAssignment_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "PromptTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptTagAssignment" ADD CONSTRAINT "PromptTagAssignment_configId_tagId_key" UNIQUE ("configId", "tagId");
