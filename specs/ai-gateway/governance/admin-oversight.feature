# The v0 mocked dashboard (summary cards, By user, anomaly and ingestion strips, Preview badge) was retired and its
# scenarios deleted; the overview screen that replaced it is covered by other specs. Only the flag gate remains.

Feature: AI Gateway Governance — Admin Oversight Dashboard
  As an organization admin (Persona 3 from gateway.md), I need a single
  page that gives me a bird's-eye view of every AI agent / IDE tool /
  ingestion source running under the organization — cross-cutting spend,
  per-user breakdown, anomaly alerts, source health — so I can answer
  "what's our AI footprint?" "who's spending too much?" "what's weird at
  3am on a Sunday?" without hopping between five admin consoles.

  Per gateway.md "Persona 3: admin supervising everything":
    🛡 Org Admin Dashboard — bird's-eye view of all activity
    "Cross-org spend / per-user usage / anomaly alerts / IngestionSource health"

  This page is the union of every other governance surface. It does NOT
  replace `/me` (Persona 1+2) or any per-project page; it summarizes
  across the org so the admin doesn't have to fan out manually.

  Iter-9 ships the UI with mocked data + the route gated behind
  `release_ui_ai_governance_enabled`. Real-data wire-up follows the
  Activity Monitor backend (D2): IngestionSource ingestion + OCSF
  normalization + cross-source aggregation. Mocked-first lets the
  admin UX get user feedback before backend invests in the per-user CH
  rollup queries.

  Background:
    Given user "platform-admin@acme.com" is signed in to organization "acme"
    And the user has the "governance:view" permission
    And the user has the "activityMonitor:view" permission
    And the feature flag "release_ui_ai_governance_enabled" is enabled

  # ---------------------------------------------------------------------------
  # Page scaffold + permission gate
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @feature-flag @integration
  Scenario: Without the governance preview flag the page is hidden
    Given the feature flag "release_ui_ai_governance_enabled" is disabled
    When the admin navigates to "/governance"
    Then the page renders the standard NotFoundScene (default-off for
      non-flagged orgs)
    And no telemetry is emitted that reveals the page exists

  # ---------------------------------------------------------------------------
  # Top summary cards (cross-cutting org totals)
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Per-user breakdown
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Anomaly alerts list
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # IngestionSource health strip
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Mocked-data caveat (for v0; real-data wire-up follows D2)
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Accessibility
  # ---------------------------------------------------------------------------
