-- ADR-201 §1: the braid writes authz sent, keyed by organisation and command id, so a retried braid
-- answers the one it saved and a write the grant projection has not landed yet still counts. A
-- new, empty table owned by authz. Column refs only, no foreign key.
CREATE TABLE IF NOT EXISTS "AuthzBraidWrite" (
    "organizationId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "readerProjectId" TEXT NOT NULL,
    "ownerProjectId" TEXT NOT NULL,
    "termsKey" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "replacesGrantId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthzBraidWrite_pkey" PRIMARY KEY ("organizationId", "commandId")
);

CREATE INDEX IF NOT EXISTS "AuthzBraidWrite_organizationId_readerProjectId_createdAt_idx"
    ON "AuthzBraidWrite" ("organizationId", "readerProjectId", "createdAt");
