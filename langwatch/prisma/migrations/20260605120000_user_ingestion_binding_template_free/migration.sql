-- UserIngestionBinding: decouple from IngestionTemplate.
--
-- The unified coding assistants (claude / codex / gemini / opencode) are no
-- longer ingestion templates. The `langwatch <tool>` CLI mints their binding
-- directly, identified by `sourceType` instead of a template row.
--
-- Invariant after this migration: every binding has a non-null `sourceType`,
-- and (personalProjectId, sourceType) is the install identity. That key is
-- per-org (personalProjectId is 1:1 with (user, org)), which fixes the old
-- global (userId, templateId) unique: it 409'd multi-org users and allowed a
-- cross-org rotation hijack (rotating an org-A binding moved its
-- personalProjectId into org-B). `templateId` is now nullable: template-free
-- CLI bindings carry NULL, template-backed bindings (claude_cowork) keep it.
--
-- relationMode = "prisma": there are no DB-level FK constraints, so the
-- template relation's onDelete (Restrict -> SetNull) is emulated by Prisma
-- Client and needs no SQL here.
--
-- Forward-only. No down migration: a rollback would have to re-impose NOT NULL
-- on templateId, which template-free rows cannot satisfy.

-- 1. templateId becomes optional (coding-assistant bindings mint with NULL).
ALTER TABLE "UserIngestionBinding" ALTER COLUMN "templateId" DROP NOT NULL;

-- 2. Canonical source slug. Backfilled from the bound template so existing
--    rows keep a stable identity under the new unique.
ALTER TABLE "UserIngestionBinding" ADD COLUMN "sourceType" TEXT;

UPDATE "UserIngestionBinding" b
SET "sourceType" = t."sourceType"
FROM "IngestionTemplate" t
WHERE b."templateId" = t."id";

-- 3. Drop any row the backfill could not resolve (a binding pointing at a
--    now-missing template). Pre-launch / dev-only data, so this is safe and
--    keeps the NOT NULL invariant clean instead of leaving dup-able NULLs.
DELETE FROM "UserIngestionBinding" WHERE "sourceType" IS NULL;

-- 4. sourceType is the install identity, so it must be non-null (Postgres
--    UNIQUE treats NULLs as distinct, which would defeat the dedup).
ALTER TABLE "UserIngestionBinding" ALTER COLUMN "sourceType" SET NOT NULL;

-- 5. Swap the GLOBAL (userId, templateId) unique for a per-personal-project,
--    per-source one.
DROP INDEX "UserIngestionBinding_userId_templateId_key";

CREATE UNIQUE INDEX "UserIngestionBinding_personalProjectId_sourceType_key"
ON "UserIngestionBinding" ("personalProjectId", "sourceType");
