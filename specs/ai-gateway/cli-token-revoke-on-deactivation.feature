Feature: AI Gateway — Revoke CLI tokens on user deactivation
  As a security-conscious admin
  I want a deactivated user's existing CLI tokens to stop working immediately
  So that an offboarded developer cannot continue calling the control plane
  for up to the access-token TTL (1h) after their browser session is killed

  Today, `userService.deactivate` calls `revokeAllSessionsForUser` which
  clears BetterAuth Postgres + Redis sessions used by the web UI. But the
  CLI device-flow tokens (`lwcli:access:*` + `lwcli:refresh:*` Redis keys)
  are written by `/api/auth/cli/exchange` and rotated by
  `/api/auth/cli/refresh` independently of BetterAuth — so a deactivated
  user's CLI access_token continues to authenticate against the control
  plane until the 1h TTL expires, and their refresh_token continues to
  mint new access tokens for up to 30d.

  This spec pins the defense-in-depth: every deactivation path also
  revokes the user's CLI tokens via `cliTokenRevocation.revokeForUser`,
  so the next call to `/api/auth/cli/budget/status` (or any other
  authenticated CLI endpoint) returns 401 immediately.

  Background:
    Given organization "acme" exists with project "gateway-demo"
    And user "user_alice" is an active member of "acme"
    And alice has completed a CLI device-flow login resulting in:
      | redis_key                  | value                                 | ttl_seconds  |
      | lwcli:access:lw_at_AAA     | { user_id: "user_alice", org: "acme" }| 3600         |
      | lwcli:refresh:lw_rt_BBB    | { user_id: "user_alice", org: "acme" }| 2592000      |
    And the per-user index key `lwcli:user:user_alice:tokens` contains both `lw_at_AAA` and `lw_rt_BBB`

  # ============================================================================
  # Revoke clears active tokens
  # ============================================================================

  @bdd @phase-1b @cli-revoke @core
  Scenario: Direct call to cliTokenRevocation clears all CLI tokens
    When I call `cliTokenRevocation.revokeForUser({ userId: "user_alice" })`
    Then `lwcli:access:lw_at_AAA` is deleted from Redis
    And `lwcli:refresh:lw_rt_BBB` is deleted from Redis
    And the per-user index `lwcli:user:user_alice:tokens` is deleted from Redis
    And the response `revokedCount` is 2

  @bdd @phase-1b @cli-revoke @no-tokens
  Scenario: Revoke is a no-op when the user has no active CLI tokens
    Given user "user_bob" has never logged in via the CLI
    When I call `cliTokenRevocation.revokeForUser({ userId: "user_bob" })`
    Then no Redis keys are touched
    And the response `revokedCount` is 0
    And no error is thrown

  # ============================================================================
  # Wired into the deactivation path
  # ============================================================================

  @bdd @phase-1b @cli-revoke @deactivation
  Scenario: userService.deactivate also revokes CLI tokens
    When the admin calls `userService.deactivate({ id: "user_alice" })`
    Then `user_alice.deactivatedAt` is set
    And `revokeAllSessionsForUser` clears BetterAuth sessions (existing behavior)
    And `cliTokenRevocation.revokeForUser` clears `lwcli:access:lw_at_AAA` and `lwcli:refresh:lw_rt_BBB`

  @bdd @phase-1b @cli-revoke @deactivation
  Scenario: SCIM deprovisioning revokes CLI tokens
    When SCIM marks alice inactive (which calls `userService.deactivate` per scim.service.ts:219)
    Then alice's CLI tokens are revoked as part of the same deactivation
    And the next CLI call to `/api/auth/cli/budget/status` with `Authorization: Bearer lw_at_AAA` returns 401

  # ============================================================================
  # End-to-end — CLI sees the revocation immediately
  # ============================================================================

  @bdd @phase-1b @cli-revoke @e2e
  Scenario: After deactivation, /budget/status returns 401 for the revoked access_token
    Given alice's access_token "lw_at_AAA" was valid 5 seconds ago
    When alice is deactivated
    And the CLI calls `GET /api/auth/cli/budget/status` with `Authorization: Bearer lw_at_AAA`
    Then the response is 401 with `error: "invalid_token"`

  @bdd @phase-1b @cli-revoke @e2e
  Scenario: After deactivation, /refresh returns 401 for the revoked refresh_token
    Given alice's refresh_token "lw_rt_BBB" had 30 days left
    When alice is deactivated
    And the CLI calls `POST /api/auth/cli/refresh { refresh_token: "lw_rt_BBB" }`
    Then the response is 401 with `error: "invalid_grant"`
    And no new access_token is minted

  # ============================================================================
  # Reactivation does NOT auto-restore old tokens
  # ============================================================================

  @bdd @phase-1b @cli-revoke @reactivation
  Scenario: Reactivating a user does not restore their old CLI tokens
    Given alice was deactivated and her tokens revoked
    When the admin calls `userService.reactivate({ id: "user_alice" })`
    Then alice's `deactivatedAt` is cleared
    But the old `lwcli:access:lw_at_AAA` and `lwcli:refresh:lw_rt_BBB` are still gone
    And alice must re-run `langwatch login` to mint a fresh device-flow token pair
