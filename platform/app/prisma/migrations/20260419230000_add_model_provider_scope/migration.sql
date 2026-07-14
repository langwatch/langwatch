-- Multi-scope + multi-instance ModelProvider (iter 109).
--
-- Rewrite of the iter 107/108 single-scope migration. Iter 107's columns
-- (scopeType, scopeId on ModelProvider) were never deployed to prod —
-- we collapse the whole journey into one step here so prod jumps
-- directly from scope-free rows to the multi-scope join-table shape.
--
-- Dev environments that already applied the earlier revision keep their
-- 198 rows intact: the backfill reads (scopeType, scopeId) when those
-- columns exist, then drops them.
--
-- Shape after:
--   ModelProvider: one row per credential, + "name" column.
--   ModelProviderScope: join table, N scope entries per ModelProvider,
--     each (scopeType, scopeId) pointing at an organization / team /
--     project the credential is accessible to.
--
-- Rollback: DROP TABLE "ModelProviderScope"; ALTER TABLE
--   "ModelProvider" DROP COLUMN "name"; and (on dev only) re-add
--   scopeType/scopeId columns then repopulate from the MPS rows.

-- 1. Create the ModelProviderScope join table.

CREATE TABLE IF NOT EXISTS "ModelProviderScope" (
    "id"              TEXT NOT NULL,
    "modelProviderId" TEXT NOT NULL,
    "scopeType"       TEXT NOT NULL,
    "scopeId"         TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelProviderScope_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModelProviderScope_modelProviderId_fkey"
        FOREIGN KEY ("modelProviderId") REFERENCES "ModelProvider" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModelProviderScope_modelProviderId_scopeType_scopeId_key"
    ON "ModelProviderScope" ("modelProviderId", "scopeType", "scopeId");

CREATE INDEX IF NOT EXISTS "ModelProviderScope_scopeType_scopeId_idx"
    ON "ModelProviderScope" ("scopeType", "scopeId");

CREATE INDEX IF NOT EXISTS "ModelProviderScope_modelProviderId_idx"
    ON "ModelProviderScope" ("modelProviderId");

-- 2. Add "name" to ModelProvider and backfill with a humanized provider
--    label. Duplicates under the same (projectId, provider) aren't
--    possible today, and in the multi-scope world duplicates are
--    disambiguated to users by scope chips — not by name — so every row
--    simply mirrors the humanized provider name. Service-layer writes
--    keep the column settable so advanced users can override later.

ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "name" TEXT;

UPDATE "ModelProvider"
   SET "name" = CASE provider
       WHEN 'openai'       THEN 'OpenAI'
       WHEN 'anthropic'    THEN 'Anthropic'
       WHEN 'gemini'       THEN 'Gemini'
       WHEN 'azure'        THEN 'Azure OpenAI'
       WHEN 'bedrock'      THEN 'Bedrock'
       WHEN 'vertex_ai'    THEN 'Vertex AI'
       WHEN 'deepseek'     THEN 'DeepSeek'
       WHEN 'xai'          THEN 'xAI'
       WHEN 'cerebras'     THEN 'Cerebras'
       WHEN 'groq'         THEN 'Groq'
       WHEN 'azure_safety' THEN 'Azure Safety'
       WHEN 'custom'       THEN 'Custom (OpenAI-compatible)'
       WHEN 'cloudflare'   THEN 'Cloudflare'
       WHEN 'mistral'      THEN 'Mistral'
       WHEN 'cohere'       THEN 'Cohere'
       WHEN 'fireworks_ai' THEN 'Fireworks AI'
       ELSE initcap(replace(provider, '_', ' '))
   END
 WHERE "name" IS NULL;

ALTER TABLE "ModelProvider" ALTER COLUMN "name" SET NOT NULL;

-- 3. Backfill ModelProviderScope. If the dev-only (scopeType, scopeId)
--    columns exist we seed from them; otherwise every row gets a single
--    PROJECT-scope entry pointing at its projectId (matching iter 107's
--    backfill intent on prod, where the columns never landed).

DO $plpgsql$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_name = 'ModelProvider'
           AND column_name = 'scopeType'
           AND table_schema = current_schema()
    ) THEN
        EXECUTE $sql$
            INSERT INTO "ModelProviderScope" ("id", "modelProviderId", "scopeType", "scopeId")
            SELECT gen_random_uuid()::text, id, "scopeType", "scopeId"
              FROM "ModelProvider"
            ON CONFLICT ("modelProviderId", "scopeType", "scopeId") DO NOTHING
        $sql$;
    ELSE
        EXECUTE $sql$
            INSERT INTO "ModelProviderScope" ("id", "modelProviderId", "scopeType", "scopeId")
            SELECT gen_random_uuid()::text, id, 'PROJECT', "projectId"
              FROM "ModelProvider"
            ON CONFLICT ("modelProviderId", "scopeType", "scopeId") DO NOTHING
        $sql$;
    END IF;
END
$plpgsql$;

-- 4. Drop the now-redundant single-scope columns. The join table is the
--    authoritative source; service-layer queries walk it. Safe no-op on
--    prod where the columns were never added.

ALTER TABLE "ModelProvider" DROP COLUMN IF EXISTS "scopeType";
ALTER TABLE "ModelProvider" DROP COLUMN IF EXISTS "scopeId";

-- Old per-row index (if ever created) is implicitly dropped with the
-- columns; nothing else references it.
