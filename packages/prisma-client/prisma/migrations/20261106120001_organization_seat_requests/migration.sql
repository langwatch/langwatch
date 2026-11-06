-- IRREVERSIBLE: adds the SeatRequest and OrganizationAccessNotice tables and their indexes.
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- Seat requests and their mail outbox (modules/organization/specs/seat-requests.feature).
-- Both tables are new, so nothing here locks a table the serving release writes.
CREATE TABLE IF NOT EXISTS "SeatRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "idpRefused" BOOLEAN NOT NULL DEFAULT false,
    "idpKind" TEXT,
    "salesNotifiedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeatRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganizationAccessNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "idp" TEXT,
    "dayKey" TEXT NOT NULL,
    "idpRefused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailedAt" TIMESTAMP(3),
    CONSTRAINT "OrganizationAccessNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeatRequest_organizationId_email_key" ON "SeatRequest"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "SeatRequest_organizationId_status_idx" ON "SeatRequest"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "SeatRequest_userId_idx" ON "SeatRequest"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationAccessNotice_organizationId_kind_email_dayKey_key" ON "OrganizationAccessNotice"("organizationId", "kind", "email", "dayKey");
