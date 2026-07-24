Feature: AI Governance — CLI sessions inventory + revoke
  As a developer who uses the LangWatch CLI on multiple machines
  I want to see every active CLI session as a device card with hostname + last-used
  And revoke any one of them with a single click
  So that a stolen laptop or finished contract doesn't leave an orphan
  session minting model-provider traffic against my budget

  Pattern: macOS / GitHub / GitLab / Vercel "Logged-in Devices" UX. The
  CLI captures `os.hostname()` + `os.userInfo().username` +
  `process.platform` at `langwatch login` time and POSTs them as
  `client_info` to `/api/auth/cli/exchange`. The control plane stamps
  them on the access + refresh token records and preserves them across
  rotations so the dashboard's "logged in 5 days ago" stays accurate.

  Background:
    Given alice is logged into LangWatch
    And alice runs `langwatch login` from "MacBook-Pro.local" on darwin

  # ============================================================================
  # Inventory rendering
  # ============================================================================

  @bdd @phase-8 @sessions @list
  Scenario: First-time login creates one session card
    When alice opens /me/sessions
    Then she sees exactly one session card
    And the card displays "Mac (MacBook-Pro.local)" as the device label
    And the card shows last-seen "just now"

  @bdd @phase-8 @sessions @list
  Scenario: Logging in from a second machine creates a second session card
    Given alice ran `langwatch login` from "MacBook-Pro.local" yesterday
    When alice runs `langwatch login` from "alice-thinkpad" on linux
    And opens /me/sessions
    Then she sees two session cards
    And the cards are sorted by last-seen-desc (thinkpad first)

  @bdd @phase-8 @sessions @list
  Scenario: Pre-Phase-8 sessions (no client_info) render as "Unknown device"
    Given alice's CLI session was minted before this slice (no client_info captured)
    When she opens /me/sessions
    Then she sees the session with deviceLabel="Unknown device"
    # Backwards-compat: old sessions stay visible + revocable, just
    # without a friendly label.

  # ============================================================================
  # Per-session revoke
  # ============================================================================

  @bdd @phase-8 @sessions @revoke
  Scenario: Revoke removes the session and invalidates its tokens immediately
    Given alice has two sessions (laptop + desktop)
    When alice clicks "Revoke" on the laptop session
    Then the laptop session disappears from the inventory
    And the next CLI call from the laptop hits 401 invalid_token
    And the desktop session is unaffected

  @bdd @phase-8 @sessions @revoke
  Scenario: Revoke-all logs every device out
    Given alice has three sessions
    When alice clicks "Sign out of all devices"
    Then the inventory becomes empty
    And every device's next CLI call hits 401 invalid_token
    And alice must run `langwatch login` on each machine to come back online

  # ============================================================================
  # Org max-session-duration policy
  # ============================================================================

  @bdd @phase-8 @sessions @ttl
  Scenario: Org with maxSessionDurationDays=0 has unbounded sessions (default)
    Given alice's org has `maxSessionDurationDays = 0`
    And her session is 100 days old
    When her CLI calls /api/auth/cli/refresh
    Then a new access token is minted normally
    # 0 = unbounded, mirrors GitHub CLI / gh-style flows.

  @bdd @phase-8 @sessions @ttl
  Scenario: Org with maxSessionDurationDays=14 expires sessions older than 14 days
    Given alice's org has `maxSessionDurationDays = 14`
    And her session is 15 days old (session_started_at)
    When her CLI calls /api/auth/cli/refresh
    Then the response is 401 invalid_grant
    And the message names the org's max-duration policy
    And alice must run `langwatch login` to start a new session

  @bdd @phase-8 @sessions @ttl
  Scenario: Session age is measured from session_started_at, not last refresh
    Given alice's org has `maxSessionDurationDays = 7`
    And her session_started_at was 8 days ago
    And her last /refresh was 1 hour ago (still has a fresh access token)
    When the access token expires and the CLI calls /refresh again
    Then 401 invalid_grant — session age 8d > 7d ceiling
    # Per-rotation refresh of issued_at would let a session live forever
    # under the policy; anchoring on session_started_at enforces the
    # actual user-perceived "logged in N days ago" boundary.
