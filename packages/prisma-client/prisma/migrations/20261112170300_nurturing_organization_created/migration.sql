-- Nurturing's own copy of when an organization was created, from organization's
-- lw.organization.created (ARCHITECTURE §9), so the per-email usage reads no owner table. One row
-- per organization, the earliest creation kept. An organization created before this copy has no
-- row and its usage sends no day offsets. NurturingProject, which already exists, holds the
-- project-to-organization copy and is now written again, from project's lw.project.created.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: a deleted organization's row is never read again.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- Undo: DROP TABLE "NurturingOrganizationCreated";
CREATE TABLE IF NOT EXISTS "NurturingOrganizationCreated" (
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingOrganizationCreated_pkey" PRIMARY KEY ("organizationId")
);
