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
