-- The largest file a dataset image or file cell accepts for one organization,
-- in mebibytes. Null means the default, so every existing row keeps it.
--
-- Spec: modules/entitlement/specs/dataset-bounds-override.feature
--
-- To roll back by hand:
--
--   ALTER TABLE "Organization" DROP COLUMN "datasetAttachmentMaxMb";

ALTER TABLE "Organization" ADD COLUMN "datasetAttachmentMaxMb" INTEGER;
