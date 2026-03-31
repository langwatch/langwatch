-- CreateTable
CREATE TABLE "PromptLabel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PromptLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptLabel_organizationId_idx" ON "PromptLabel"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptLabel_organizationId_name_key" ON "PromptLabel"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "PromptLabel" ADD CONSTRAINT "PromptLabel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptLabel" ADD CONSTRAINT "PromptLabel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
