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
FROM "Project" p
JOIN "Team" t ON t.id = p."teamId"
JOIN "PromptTag" pt ON pt."organizationId" = t."organizationId" AND pt.name = a.tag
WHERE a."projectId" = p.id;

-- Step 4: Set tagId NOT NULL
ALTER TABLE "PromptTagAssignment" ALTER COLUMN "tagId" SET NOT NULL;

-- Step 5: Drop the old tag column
ALTER TABLE "PromptTagAssignment" DROP COLUMN "tag";

-- Step 6: Add FK constraint
ALTER TABLE "PromptTagAssignment" ADD CONSTRAINT "PromptTagAssignment_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "PromptTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 7: Drop old unique constraint and add new one
ALTER TABLE "PromptTagAssignment" DROP CONSTRAINT "PromptTagAssignment_configId_tag_key";
ALTER TABLE "PromptTagAssignment" ADD CONSTRAINT "PromptTagAssignment_configId_tagId_key" UNIQUE ("configId", "tagId");
