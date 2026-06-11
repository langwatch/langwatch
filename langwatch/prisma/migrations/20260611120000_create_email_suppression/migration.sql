-- ADR-031: recipient unsubscribe / suppression list for trigger emails.
--
-- A row suppresses delivery of trigger email to `email` within `projectId`.
-- A null `triggerId` suppresses every trigger in the project; a set `triggerId`
-- suppresses only that one. `reason` leaves room for future "bounce" rows.

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "triggerId" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_projectId_email_triggerId_key" ON "EmailSuppression"("projectId", "email", "triggerId");

-- CreateIndex
CREATE INDEX "EmailSuppression_projectId_idx" ON "EmailSuppression"("projectId");

-- AddForeignKey
ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- To roll back, uncomment and run manually:
-- DROP TABLE "EmailSuppression";
