-- The window an ingestion source read while pulled cost recording was off for
-- its organization, so the spend on those days was dropped instead of priced.
--
-- Both columns null on every existing row, which is the honest starting state:
-- we cannot reconstruct which past runs dropped money, because nothing recorded
-- it at the time. The window fills forward from the first run after this ships.
ALTER TABLE "IngestionSource"
  ADD COLUMN "unpricedUsageSince" TIMESTAMP(3),
  ADD COLUMN "unpricedUsageThrough" TIMESTAMP(3);
