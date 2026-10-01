-- The confirmed stored object a dataset is imported from (ADR-158). Nullable and
-- additive: the image still serving never names it.
ALTER TABLE "Dataset" ADD COLUMN "sourceStoredObjectId" TEXT;
