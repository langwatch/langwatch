-- Model ids a custom provider's /v1/models listing carried on the last save that imported from
-- it. The import on save adds only ids missing from this list, so a model the user removed is not
-- imported again. Nullable with no default: the previous release never reads or writes it.
--
-- Down, to roll back by hand:
--   ALTER TABLE "ModelProvider" DROP COLUMN "lastListedModelIds";
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "lastListedModelIds" JSONB;
