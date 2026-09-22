-- Dated person → department links (ADR-128 §13, #7882).
--
-- "OrganizationUser"."departmentId" keeps being the current assignment every
-- screen reads. These rows are its history, appended by the same assignUser
-- write, so the cost reads can resolve the link that was open on a cost's day
-- instead of today's pointer - January's spend stays with January's
-- department through a reorg.
--
-- Same shape and same guard as "IdentityMatch": nothing here needs an
-- extension, because the only overlap that can occur is a second OPEN link,
-- and the partial unique index below rejects that with SQLSTATE 23505.
CREATE TABLE "DepartmentMembershipHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    -- Null means the link is open. Reassignment and clearing close it.
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMembershipHistory_pkey" PRIMARY KEY ("id")
);

-- The read: "which link was open on day D for these members" - walks
-- (organizationId, userId) and compares dates.
CREATE INDEX "DepartmentMembershipHistory_organizationId_userId_validFrom_idx"
    ON "DepartmentMembershipHistory"("organizationId", "userId", "validFrom");

-- One open link per member per organization. Closed rows are outside the
-- index on purpose: history may hold as many closed links as there were
-- reorgs.
CREATE UNIQUE INDEX "DepartmentMembershipHistory_one_open_link_key"
    ON "DepartmentMembershipHistory"("organizationId", "userId")
    WHERE "validTo" IS NULL;
