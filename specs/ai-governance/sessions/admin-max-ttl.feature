Feature: Admin-controlled max session lifetime (max-TTL)
  As an org admin enforcing a security policy
  I want to cap the maximum lifetime of CLI sessions org-wide
  So that stale long-lived tokens don't accumulate on lost / decommissioned
  devices indefinitely

  Backed by `Organization.maxSessionDurationDays` (Int, default 0 = unbounded).
  Enforced at /api/auth/cli/refresh — when an org caps sessions, refresh
  rejects expired sessions with a clear `error: "session_expired"` so the
  CLI can prompt re-login.

  Spec maps to Phase 8 backend (Sergey: P8-schema, P8-refresh-ttl) + UI
  (Alexis: P8-ui-admin-ttl).

  Background:
    Given organization "acme" exists
    And alice is an org ADMIN of "acme"
    And bob is an org member of "acme" with an active CLI session

  Scenario: Default behavior — no cap
    Given "acme" has `maxSessionDurationDays = 0` (default)
    When bob's CLI calls `POST /api/auth/cli/refresh` 90 days after issue
    Then the refresh succeeds (no expiry enforcement)

  Scenario: Admin sets max-TTL → existing too-old sessions expire on next refresh
    Given "acme" has 3 active sessions: bob's laptop (issued 60d ago), bob's CI runner (issued 5d ago), eve's laptop (issued 35d ago)
    When alice updates `Organization.maxSessionDurationDays = 30` via `api.organization.update({ maxSessionDurationDays: 30 })`
    And bob's laptop session calls `POST /api/auth/cli/refresh`
    Then refresh returns 401 with `{ error: "session_expired", error_description: "Your CLI session is older than your organization's policy. Please run langwatch login again." }`
    And eve's laptop similarly returns 401
    And bob's CI runner (5d old) refresh succeeds (within window)

  Scenario: New sessions get capped to the policy
    Given "acme" has `maxSessionDurationDays = 30`
    When bob runs `langwatch login --device` and the new access token issues at `2026-05-03T00:00:00Z`
    Then the access-token record's `expires_at` is no later than `2026-06-02T00:00:00Z` (30 days)
    And the refresh-token record's `expires_at` is no later than `2026-06-02T00:00:00Z`

  Scenario: CLI surfaces the session_expired envelope as actionable
    Given bob's CLI receives the 401 `session_expired` envelope from /refresh
    When the CLI handles the response
    Then stderr renders: "Your CLI session is older than your organization's policy. Please run `langwatch login --device` again."
    And the local `~/.langwatch/config.json` is wiped so the next CLI invocation prompts a fresh login

  Scenario: Lowering max-TTL to 0 (un-cap) re-enables long-lived sessions immediately
    Given "acme" was at `maxSessionDurationDays = 7`
    When alice updates `maxSessionDurationDays = 0`
    Then the next `POST /api/auth/cli/refresh` from any session (regardless of age) succeeds
    And no historical sessions need to be re-issued

  Scenario: Permission gate
    When bob (org MEMBER) calls `api.organization.update({ maxSessionDurationDays: 7 })`
    Then the call returns FORBIDDEN — only org ADMIN can change the policy
