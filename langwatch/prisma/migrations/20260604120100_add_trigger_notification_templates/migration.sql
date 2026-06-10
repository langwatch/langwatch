-- Customer-customizable Liquid notification templates for triggers.
--
-- See dev/docs/adr/028-liquid-templates-for-trigger-notifications.md. Four
-- nullable columns: NULL means "render with the framework default", so every
-- existing trigger sees no change. slackTemplateType discriminates how the
-- Slack template output is sent ('string' plain text vs 'block_kit' JSON).

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "slackTemplateType" TEXT;
ALTER TABLE "Trigger" ADD COLUMN "slackTemplate" TEXT;
ALTER TABLE "Trigger" ADD COLUMN "emailSubjectTemplate" TEXT;
ALTER TABLE "Trigger" ADD COLUMN "emailBodyTemplate" TEXT;

-- To roll back, uncomment and run manually:
-- ALTER TABLE "Trigger" DROP COLUMN "slackTemplateType";
-- ALTER TABLE "Trigger" DROP COLUMN "slackTemplate";
-- ALTER TABLE "Trigger" DROP COLUMN "emailSubjectTemplate";
-- ALTER TABLE "Trigger" DROP COLUMN "emailBodyTemplate";
