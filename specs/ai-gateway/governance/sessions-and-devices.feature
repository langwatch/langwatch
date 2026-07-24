Feature: AI Gateway Governance — Sessions and Devices Inventory
  As an end user managing my own LangWatch credentials across machines
  I want a single inventory of every active session and device-bound
  credential I have — including web sign-ins, CLI device logins, and
  ingestion keys minted from /me Trace Ingest — with a clear revoke
  affordance and a label that tells me which laptop / process it belongs to
  And as an org admin enforcing a maximum session lifetime
  I want a per-organization `maxSessionDurationDays` policy that applies
  uniformly to every credential type — short-lived web cookies, long-lived
  CLI device tokens, and never-expiring ingestion keys — so compliance
  with SOC2 / ISO27001 session-lifetime requirements is enforced at
  infrastructure level, not relying on per-user discipline

  Per gateway.md "sessions & devices":
    Three credential classes share one inventory:
      • web session — short-lived cookie + refresh
      • CLI device session — `langwatch login --device` against ~/.langwatch
      • ingestion key — `sk-lw-<...>` (write-only, ingest-only ApiKey) minted
        from /me Trace Ingest

  Per ingestion-templates-catalog.feature + ingestion-key-lifecycle.feature:
    Ingestion keys are TODAY surfaced ONLY at /me Trace Ingest tile-grid
    (per-template). They MUST also appear in the unified /me/sessions
    inventory so users can revoke + admins can apply max-session-duration.

  Background:
    Given organization "acme" exists
    And admin "carol@acme.com" has the `organization:manage` permission
    And user "jane@acme.com" has personal project "personal-jane"
    And jane has signed in on:
      | session class    | label                       | last used   |
      | web session      | "MacBook Pro — Chrome"      | 2 hours ago |
      | CLI device       | "MacBook Pro — claude-code"  | 1 day ago   |
      | ingestion key    | "claude_code template"       | 3 hours ago |
      | ingestion key    | "cursor template"            | 12 days ago |

  # ---------------------------------------------------------------------------
  # User-facing inventory at /me/sessions
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @inventory @user-visibility
  Scenario: User sees ALL credential classes in one list at /me/sessions
    When jane navigates to "/me/sessions"
    Then she sees a card-grid with exactly 4 cards:
      | label                       | class            | revoke affordance |
      | "MacBook Pro — Chrome"      | web              | "Revoke session"  |
      | "MacBook Pro — claude-code" | cli              | "Revoke device"   |
      | "claude_code template"      | ingest_key       | "Rotate / Revoke" |
      | "cursor template"           | ingest_key       | "Rotate / Revoke" |
    And each card displays: class icon + human-readable label + last-used
        relative time + first-issued absolute time
    And there is a "Revoke all sessions" button at the top of the page

  @bdd @sessions-and-devices @inventory @binding-tokens-included
  Scenario: Ingestion keys appear in /me/sessions alongside CLI sessions
    Given jane has only one credential — an ingestion key for claude_code
    When jane navigates to "/me/sessions"
    Then she sees ONE card for the claude_code ingestion key
    And the card class label is "Ingestion key · claude_code"
    And the card last-used reflects the ingestion key's `lastUsedAt`
    # The /me/sessions inventory is the authoritative single-pane-of-glass
    # for every active credential. No credential type is invisible from this
    # page (defense against losing track of long-lived keys).

  # ---------------------------------------------------------------------------
  # Single-card revoke
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @revoke-single
  Scenario Outline: User revokes a single credential card
    Given jane has the credentials from Background
    When she clicks "Revoke" on the "<class>" card with label "<label>"
    Then the credential is invalidated — subsequent use returns 401
    And a confirmation toast appears: "<class> revoked"
    And an audit row "<audit kind>" is emitted

    Examples:
      | class      | label                       | audit kind                                      |
      | web        | "MacBook Pro — Chrome"      | gateway.web_session.revoked                     |
      | cli        | "MacBook Pro — claude-code" | gateway.cli_device.revoked                      |
      | ingest_key | "claude_code template"      | gateway.ingestion_key.revoked                   |

  # ---------------------------------------------------------------------------
  # Bulk revoke — security-relevant signal
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @revoke-all
  Scenario: User revokes all sessions in one click (account-takeover recovery)
    Given jane has 4 active credentials (per Background)
    When she clicks "Revoke all sessions" and confirms the dialog
    Then ALL 4 credentials are invalidated
    And one audit row PER credential class is emitted (4 total)
    And jane is signed out of the current web session and redirected to /auth/signin
    # Account-takeover recovery primitive — rotates every key surface in one action.

  # ---------------------------------------------------------------------------
  # Org-level max-session-duration policy
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @max-duration @policy
  Scenario: Admin sets org-level maxSessionDurationDays
    Given the org's current `maxSessionDurationDays` is NULL (unlimited)
    When carol navigates to /settings/governance and sets `maxSessionDurationDays` to 30
    Then `Organization.maxSessionDurationDays` is updated to 30
    And an audit row `gateway.organization.max_session_duration_changed`
        with payload { previousDays: null, newDays: 30, actorUserId: carol.id } is emitted

  @bdd @sessions-and-devices @max-duration @enforcement-uniform
  Scenario Outline: maxSessionDurationDays enforces ALL credential classes uniformly
    Given the org's `maxSessionDurationDays` is 30
    And jane has a "<class>" credential issued "<age>" ago
    When she attempts to use it
    Then the credential "<outcome>"

    Examples:
      | class      | age      | outcome                                                |
      | web        | 25 days  | succeeds (within window)                               |
      | web        | 31 days  | rejected with 401 + redirect to /auth/signin           |
      | cli        | 28 days  | succeeds (within window)                               |
      | cli        | 35 days  | rejected with 401 + CLI prompts re-login                |
      | ingest_key | 29 days  | succeeds (within window)                                |
      | ingest_key | 45 days  | rejected with 401 — tile shows "Key expired — rotate"   |

  @bdd @sessions-and-devices @max-duration @policy-change-applies-going-forward
  Scenario: Tightening maxSessionDurationDays revokes sessions older than the new cap
    Given the org's `maxSessionDurationDays` was 90 and is being changed to 30
    And jane has an ingestion key issued 60 days ago (was within old cap, exceeds new cap)
    When carol commits the policy change to 30 days
    Then jane's 60-day-old ingestion key is invalidated immediately
        (next use returns 401 with "Key expired — rotate")
    And an audit row `gateway.ingestion_key.expired_by_policy` is emitted
        with payload { apiKeyId, previousMaxDays: 90, newMaxDays: 30 }
    # Policy tightening MUST apply retroactively — that's the point of the
    # policy. Loosening (e.g. 30 → 90) does NOT extend already-revoked keys.

  # ---------------------------------------------------------------------------
  # Admin oversight surface
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @admin-bird-eye
  Scenario: Admin sees per-user session counts on the bird-eye dashboard
    Given the org has 25 users with various session counts
    When carol navigates to "/governance" and selects the "Sessions" widget
    Then she sees an aggregate view: total active credentials by class +
        a top-N list of users with the most active credentials
    And clicking a user row drills into that user's /me/sessions view
        (via the existing admin-trace-access drill-in pattern, with the
        same persistent banner indicating impersonation)

  # ---------------------------------------------------------------------------
  # Cross-org isolation
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @cross-org-isolation
  Scenario: Org-level policies do NOT bleed across orgs
    Given two orgs "acme" (maxSessionDurationDays=30) and "beta-corp" (maxSessionDurationDays=null)
    And user "lisa@beta-corp.com" has a 60-day-old ingestion key under beta-corp
    When the policy applies
    Then lisa's beta-corp ingestion key stays valid (her org's policy is null)
    And acme's policy does not affect any beta-corp credential

  # ---------------------------------------------------------------------------
  # No-leak invariant
  # ---------------------------------------------------------------------------

  @bdd @sessions-and-devices @inventory @no-leak
  Scenario: User sees only their own credentials at /me/sessions (never other users')
    Given jane has 4 credentials (per Background)
    And user "ben@acme.com" has 2 credentials of his own
    When jane visits /me/sessions
    Then she sees exactly 4 cards
    And ben's 2 credentials are NOT listed
    # /me/sessions is per-user; admin oversight is at /governance per the
    # admin-bird-eye scenario. Cross-user leakage would be a P0.
