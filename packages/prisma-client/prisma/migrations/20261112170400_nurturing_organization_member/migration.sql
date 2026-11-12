-- Nurturing's own copy of each organization's members, owned by nurturing, written from the
-- owners' member facts (ARCHITECTURE §9): organization's lw.organization.signed_up and
-- lw.organization.invite_accepted and auth's lw.auth.sso_auto_added as joins,
-- lw.organization.member_removed and member_disabled as leaves, member_enabled as a return. Each
-- column keeps its latest time, so a redelivery or a late fact changes nothing. The usage sync
-- mirrors an organization's traits onto the members whose latest join it is, reading no other
-- module. A member who joined before this copy has no row.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingOrganizationMember";

CREATE TABLE IF NOT EXISTS "NurturingOrganizationMember" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "NurturingOrganizationMember_pkey" PRIMARY KEY ("organizationId", "userId")
);

CREATE INDEX IF NOT EXISTS "NurturingOrganizationMember_userId_idx" ON "NurturingOrganizationMember" ("userId");
