-- D11: the member-approval invite workflow is retired (epic Q13) - the
-- member-wants-a-colleague-in motivation moves to D12's join requests.
-- WAITING_APPROVAL rows were never actionable invitations (no email was
-- sent, no code was shared), so they close as REVOKED rather than becoming
-- live invites nobody asked to send. The enum value itself stays: dropping
-- a Postgres enum value means rebuilding the type, and nothing writes it
-- any more.
UPDATE "OrganizationInvite" SET "status" = 'REVOKED' WHERE "status" = 'WAITING_APPROVAL';
