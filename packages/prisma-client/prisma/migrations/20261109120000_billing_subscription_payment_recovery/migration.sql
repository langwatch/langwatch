-- IRREVERSIBLE: adds nullable columns to "Subscription".
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- The open failed payment recovery case (enterprise/modules/billing/adrs/002-failed-payment-recovery.md).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paymentRecoveryInvoiceId" TEXT, ADD COLUMN IF NOT EXISTS "paymentRecoveryStartedAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "paymentRecoveryNoticeDay" INTEGER;
