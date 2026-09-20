-- IRREVERSIBLE: no down step. Reversing it would drop the connected billing
-- tables with every true-up intent, statement and invoice reference in them,
-- which is what says a customer was already invoiced for a quarter. Replaying
-- against Stripe after such a rollback would invoice twice. Rolling the code
-- back is safe, the tables stay unread.
--
-- Invoice billing for a connected self-hosted customer (ADR-139, section 7).
--
-- Additive only: new tables and enums. A self-hosted install gets them and
-- keeps them empty, because every row here is written on LangWatch Cloud.

-- CreateEnum
CREATE TYPE "ConnectedSeatTrueUpState" AS ENUM ('intent', 'invoiced', 'nothing_to_invoice', 'flagged', 'skipped');

-- CreateTable
CREATE TABLE "ConnectedSeatTrueUp" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "quarterStartsAt" TIMESTAMP(3) NOT NULL,
    "peakSeats" INTEGER NOT NULL,
    "addedSeats" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "stripeInvoiceId" TEXT,
    "state" "ConnectedSeatTrueUpState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedSeatTrueUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectedSeatTrueUp_state_idx" ON "ConnectedSeatTrueUp"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedSeatTrueUp_licenseId_quarterStartsAt_key" ON "ConnectedSeatTrueUp"("licenseId", "quarterStartsAt");

-- CreateIndex
CREATE INDEX "ConnectedStatement_accountId_idx" ON "ConnectedStatement"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedStatement_accountId_month_key" ON "ConnectedStatement"("accountId", "month");

-- CreateEnum
CREATE TYPE "ConnectedCreditGrantKind" AS ENUM ('commit', 'added', 'renewal');

-- CreateEnum
CREATE TYPE "ConnectedInvoiceKind" AS ENUM ('annual', 'seat_trueup', 'usage');

-- CreateTable
CREATE TABLE "ConnectedBillingAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "usageSubscriptionId" TEXT,
    "usageSubscriptionItemId" TEXT,
    "termStartsAt" TIMESTAMP(3) NOT NULL,
    "termEndsAt" TIMESTAMP(3) NOT NULL,
    "commitUsdCents" INTEGER NOT NULL DEFAULT 0,
    "seatCurrency" "Currency" NOT NULL,
    "seatRateCents" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL,
    "bankTransferType" TEXT,
    "bankTransferCountry" TEXT,
    "billingEmail" TEXT NOT NULL,
    "pendingRenewal" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedBillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedCreditGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stripeCreditGrantId" TEXT NOT NULL,
    "amountUsdCents" INTEGER NOT NULL,
    "kind" "ConnectedCreditGrantKind" NOT NULL,
    "termEndsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedCreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedInvoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "kind" "ConnectedInvoiceKind" NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "rolledForwardTo" TEXT,
    "paidOutOfBandAt" TIMESTAMP(3),
    "quarterStartsAt" TIMESTAMP(3),
    "termStartsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedBillingAccount_organizationId_key" ON "ConnectedBillingAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedBillingAccount_stripeCustomerId_key" ON "ConnectedBillingAccount"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedCreditGrant_stripeCreditGrantId_key" ON "ConnectedCreditGrant"("stripeCreditGrantId");

-- CreateIndex
CREATE INDEX "ConnectedCreditGrant_accountId_idx" ON "ConnectedCreditGrant"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedInvoice_stripeInvoiceId_key" ON "ConnectedInvoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "ConnectedInvoice_accountId_idx" ON "ConnectedInvoice"("accountId");
