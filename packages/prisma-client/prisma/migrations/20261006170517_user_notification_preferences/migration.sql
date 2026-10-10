-- This person's answer about browser notifications, one entry per topic:
-- { "langy": "enabled" | "declined" }. A topic that is absent was never
-- answered, so the default is the empty object and every existing row reads
-- as "never asked". The browser's own permission is not stored here.
--
-- Spec: specs/langy/langy-notifications.feature
--
-- IRREVERSIBLE: there is no down migration.
--
-- The schema part reverses with the statement below, run by hand:
--
--   ALTER TABLE "User" DROP COLUMN "notificationPreferences";
--
-- The data part does not: dropping the column makes Langy offer
-- notifications to every person again.

ALTER TABLE "User" ADD COLUMN "notificationPreferences" JSONB NOT NULL DEFAULT '{}';
