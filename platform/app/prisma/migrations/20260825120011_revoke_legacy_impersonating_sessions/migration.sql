-- The ONE revoke this deliverable performs, and the one designed exception to
-- the additive-only rule (D06 - see
-- specs/identity/mfa-and-session-shape.feature, scenario "The one revoke at
-- deploy is the impersonating sessions").
--
-- It ends EXACTLY the sessions holding a non-null legacy `impersonating`
-- payload and nothing else. Those are LangWatch operators mid-impersonation, a
-- handful of rows, and the payload underneath them is about to be deleted by
-- the next migration - so leaving them would leave a session claiming an
-- impersonation nothing can read. They start again in one click.
--
-- Every ordinary session is untouched, including every session that recorded
-- nothing about what it proved. `impersonating IS NOT NULL` is the whole
-- predicate: no user id, no date range, no "while we are here".
--
-- To roll back, uncomment and run manually - though there is nothing to roll
-- back to. A deleted session row cannot be restored, and the operators it
-- belonged to re-impersonate rather than recover it.

DELETE FROM "Session" WHERE "impersonating" IS NOT NULL;
