-- A copy side's other organization, signed with the approval (staff-access module ADR-002).
ALTER TABLE "StaffAccessRequest" ADD COLUMN IF NOT EXISTS "counterpartOrganizationId" TEXT,
ADD COLUMN IF NOT EXISTS "counterpartOrganizationName" TEXT;
