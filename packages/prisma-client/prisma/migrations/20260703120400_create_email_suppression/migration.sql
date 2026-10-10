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
-- Postgres treats NULLs as distinct, so a plain composite unique on a nullable
-- triggerId would allow duplicate project-wide rows. Use two partial unique
-- indexes: one enforces a single (projectId, email) project-wide suppression
-- (triggerId IS NULL), the other enforces per-trigger uniqueness.
CREATE UNIQUE INDEX "EmailSuppression_projectId_email_triggerId_key" ON "EmailSuppression"("projectId", "email", "triggerId") WHERE "triggerId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_projectId_email_null_trigger_key" ON "EmailSuppression"("projectId", "email") WHERE "triggerId" IS NULL;

-- CreateIndex
CREATE INDEX "EmailSuppression_projectId_idx" ON "EmailSuppression"("projectId");

-- AddForeignKey
ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- To roll back, uncomment and run manually:
-- DROP TABLE "EmailSuppression";
