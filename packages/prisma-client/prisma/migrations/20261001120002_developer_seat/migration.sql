-- ADR-143: the Developer seat.
--
-- A fourth organisation role. Additive only: a used enum value is never
-- removed, so there is no down path, and existing rows are untouched.
ALTER TYPE "OrganizationUserRole" ADD VALUE 'DEVELOPER';

-- Which seat a person admitted without an invitation receives: a self-service
-- domain join or an SSO-admitted login. Defaults to MEMBER (a Full seat) so no
-- existing organisation changes behaviour. Invitations always name their own
-- role and never read this.
ALTER TABLE "Organization"
  ADD COLUMN "joinerRole" "OrganizationUserRole" NOT NULL DEFAULT 'MEMBER';
