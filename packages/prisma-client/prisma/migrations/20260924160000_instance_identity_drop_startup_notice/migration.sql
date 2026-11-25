-- AlterTable
-- Irreversible: the dismissal state is discarded, nothing reads it any more.
ALTER TABLE "InstanceIdentity" DROP COLUMN IF EXISTS "startupNoticeAcknowledgedSchemaVersion";
