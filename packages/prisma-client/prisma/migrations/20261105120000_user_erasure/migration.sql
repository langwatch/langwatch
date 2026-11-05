-- CreateTable
CREATE TABLE IF NOT EXISTS "UserErasure" (
    "id" TEXT NOT NULL,
    "accountCreatedAt" TIMESTAMP(3) NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserErasure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserErasure_accountCreatedAt_idx" ON "UserErasure"("accountCreatedAt");
