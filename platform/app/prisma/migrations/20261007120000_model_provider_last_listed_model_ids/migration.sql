-- Model ids a custom provider's /v1/models listing carried on the last save
-- that imported from it. The import on save adds only ids missing from this
-- list, so a model the user removed is not imported again.
--
-- Down, to roll back by hand:
--   ALTER TABLE "ModelProvider" DROP COLUMN "lastListedModelIds";
ALTER TABLE "ModelProvider" ADD COLUMN "lastListedModelIds" JSONB;
