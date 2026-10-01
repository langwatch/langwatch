-- DropIndex
DROP INDEX IF EXISTS "Organization_ssoDomain_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Organization_ssoDomain_key" ON "Organization"("ssoDomain");
