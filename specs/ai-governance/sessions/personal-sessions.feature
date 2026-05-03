Feature: Personal CLI sessions / devices inventory
  As a developer who runs `langwatch login` from one or more machines (laptop,
  workstation, dev container, CI runner)
  I want a "logged-in devices" surface at /me/sessions
  So that I can see where my CLI is signed in, identify each session by device,
  and revoke any session that's stale, lost, or compromised

  This mirrors the macOS "Logged-in devices" / GitHub "Active sessions" /
  Apple ID "Trusted devices" pattern: per-session metadata captured at
  device-flow exchange + a single API the user controls.

  Spec maps to Phase 8 backend (Sergey: P8-schema, P8-exchange, P8-list-api,
  P8-int-test) + UI (Alexis: P8-ui-sessions, P8-dogfood) + docs (Andre:
  P8-docs).

  Background:
    Given alice exists as an organization user of "acme"
    And alice has an active CLI device-flow access token + refresh token

  Scenario: First /exchange captures device fingerprint
    Given alice runs `langwatch login --device` from her MacBook Pro hostname "alice-mbp.local"
    When the CLI POSTs `/api/auth/cli/exchange` with `client_info: { device_label: "alice-mbp.local", uname: "Darwin alice-mbp.local 24.0.0 …", platform: "darwin" }`
    Then the AccessTokenRecord persists `device_label = "alice-mbp.local"` + `device_uname` + `client_platform = "darwin"` + `created_at` + `last_used_at`
    And the RefreshTokenRecord carries the same metadata so the session survives access-token rotation

  Scenario: List returns enriched metadata for current user only
    Given alice has 3 active CLI sessions (MacBook Pro, work Linux desktop, CI runner stub)
    And bob has 1 active CLI session
    When alice queries `api.personalSessions.list({})`
    Then she sees exactly 3 entries, each with `id` + `device_label` + `client_platform` + `created_at` + `last_used_at`
    And she does NOT see bob's session (cross-user isolation)

  Scenario: Revoke clears the targeted token only
    Given alice has 3 active CLI sessions (laptop, desktop, CI runner)
    When alice calls `api.personalSessions.revoke({ id: <CI-runner-session-id> })`
    Then the access-token + refresh-token Redis keys for that session are DEL'd
    And the entry disappears from `api.personalSessions.list({})`
    And subsequent `GET /api/auth/cli/budget/status` with the revoked CI-runner Bearer returns 401
    And alice's laptop + desktop sessions remain unaffected

  Scenario: revokeAll clears every session for the current user
    Given alice has 5 active CLI sessions
    When alice calls `api.personalSessions.revokeAll({})`
    Then all 5 sessions disappear from `api.personalSessions.list({})`
    And `lwcli:user:<alice-id>:tokens` Redis index is empty

  Scenario: Last-used timestamp advances on /budget/status hit
    Given alice's laptop session has `last_used_at = 2026-05-03T10:00:00Z`
    When the CLI from laptop calls `GET /api/auth/cli/budget/status` at `2026-05-03T10:15:00Z`
    Then the access-token record's `last_used_at` updates to `2026-05-03T10:15:00Z`
    And the next `api.personalSessions.list({})` reflects the new timestamp

  Scenario: Missing client_info on legacy CLI versions degrades gracefully
    Given an older `langwatch` CLI version that doesn't send `client_info`
    When that CLI POSTs `/api/auth/cli/exchange` with no `client_info` field
    Then the access-token record persists with `device_label = null` + `device_uname = null` + `client_platform = "unknown"`
    And `api.personalSessions.list({})` renders the entry with a fallback label "(unknown device)" + last-used timestamp
