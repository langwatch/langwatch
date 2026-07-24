-- Department scope for AiToolEntry. The tile "Visible to" model becomes
-- WHOLE ORGANIZATION (empty set) or a set of DEPARTMENTS. Mirrors the
-- existing AiToolEntryTeam join table, swapping teamId for departmentId.
--
-- Non-destructive: the legacy AiToolEntryTeam table is left in place (the
-- service stops writing to it). Existing rows keep working through the
-- back-compat scope/scopeId pair until a later migration drops them.
--
-- departmentId is a plain column ref (relationMode="prisma"), matching how
-- Department is referenced from OrganizationUser/Team/Project. No FK to
-- Department by convention; the service validates the id belongs to the org.

-- AiToolEntryDepartment - per-department scope binding. Empty set = org-wide.
-- Non-empty set = entry visible only to members of those departments.
CREATE TABLE "AiToolEntryDepartment" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "AiToolEntryDepartment_pkey" PRIMARY KEY ("id")
);

-- At most one binding per (entry, department).
CREATE UNIQUE INDEX "AiToolEntryDepartment_entryId_departmentId_key"
    ON "AiToolEntryDepartment"("entryId", "departmentId");

CREATE INDEX "AiToolEntryDepartment_departmentId_idx"
    ON "AiToolEntryDepartment"("departmentId");

ALTER TABLE "AiToolEntryDepartment"
    ADD CONSTRAINT "AiToolEntryDepartment_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "AiToolEntry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
