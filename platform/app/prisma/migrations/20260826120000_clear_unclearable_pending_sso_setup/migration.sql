-- Releases the people held behind an SSO banner that nothing could dismiss.
--
-- `beforeAccountCreate` read an organization holding a `ssoDomain` with a null
-- `ssoProvider` as a provider MISMATCH and set `pendingSsoSetup = true`.
-- Nothing could then unset it: `isSsoProviderMatch` returns false for every
-- account when `ssoProvider` is null, and the only writer of
-- `pendingSsoSetup = false` sits behind that same match. The flag went up on
-- one sign-in and no later sign-in took it down, whatever provider the person
-- used, leaving "Action Required: Link your SSO account" with no action that
-- cleared it.
--
-- The hook now returns before that write, so no new rows reach this state.
-- This clears the ones already stranded.
--
-- Scoped to organizations that still name no provider. Where one IS
-- configured the flag is a live SSO migration doing its job -- the next
-- sign-in through the configured provider clears it -- so those rows are left
-- exactly as they are. Rows whose email domain matches no organization at all
-- are also left alone: the hook never wrote them, so they are an operator's
-- own doing (the self-hosting SSO runbook flags users by domain) and not ours
-- to undo.
--
-- Idempotent: every row it selects it sets to false, so a second run matches
-- nothing. The domain join mirrors the hook's own `extractEmailDomain`, which
-- lowercases the domain before the lookup.
UPDATE "User"
SET "pendingSsoSetup" = false
WHERE "pendingSsoSetup" = true
  AND EXISTS (
    SELECT 1
    FROM "Organization"
    WHERE "Organization"."ssoDomain" = lower(split_part("User"."email", '@', 2))
      AND "Organization"."ssoProvider" IS NULL
  );
