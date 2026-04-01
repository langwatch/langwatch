-- CreateTable
CREATE TABLE "PromptTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PromptTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptTag_organizationId_idx" ON "PromptTag"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTag_organizationId_name_key" ON "PromptTag"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "PromptTag" ADD CONSTRAINT "PromptTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTag" ADD CONSTRAINT "PromptTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed built-in "production" and "staging" tags for every existing organization
INSERT INTO "PromptTag" (id, "organizationId", name, "createdAt", "updatedAt", "createdById")
SELECT
  'ptag_' || gen_random_uuid()::text,
  o.id,
  t.tag,
  NOW(),
  NOW(),
  NULL
FROM "Organization" o
CROSS JOIN (VALUES ('production'), ('staging')) AS t(tag)
ON CONFLICT ("organizationId", name) DO NOTHING;

-- Rename PromptVersionLabel table to PromptVersionTag
ALTER TABLE "PromptVersionLabel" RENAME TO "PromptVersionTag";

-- Rename "label" column to "tag"
ALTER TABLE "PromptVersionTag" RENAME COLUMN "label" TO "tag";

-- Rename indexes
ALTER INDEX "PromptVersionLabel_pkey" RENAME TO "PromptVersionTag_pkey";
ALTER INDEX "PromptVersionLabel_configId_idx" RENAME TO "PromptVersionTag_configId_idx";
ALTER INDEX "PromptVersionLabel_versionId_idx" RENAME TO "PromptVersionTag_versionId_idx";
ALTER INDEX "PromptVersionLabel_projectId_idx" RENAME TO "PromptVersionTag_projectId_idx";
ALTER INDEX "PromptVersionLabel_configId_label_key" RENAME TO "PromptVersionTag_configId_tag_key";

-- Rename foreign key constraints
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_configId_fkey" TO "PromptVersionTag_configId_fkey";
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_versionId_fkey" TO "PromptVersionTag_versionId_fkey";
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_createdById_fkey" TO "PromptVersionTag_createdById_fkey";
ALTER TABLE "PromptVersionTag" RENAME CONSTRAINT "PromptVersionLabel_updatedById_fkey" TO "PromptVersionTag_updatedById_fkey";
