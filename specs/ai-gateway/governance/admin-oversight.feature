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
    Given user "platform-admin@miro.com" is signed in to organization "miro"
    And the user has the "organization:manage" permission
    And the feature flag "release_ui_ai_governance_enabled" is enabled

  # ---------------------------------------------------------------------------
  # Page scaffold + permission gate
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @permission
  Scenario: A non-admin user is redirected away from the dashboard
    Given user "engineer@miro.com" is signed in but does NOT have
      "organization:manage"
    When she navigates to "/settings/governance"
    Then she is redirected (or shown the existing settings-permission
      "Not allowed" page)

  @bdd @ui @admin-oversight @permission
  Scenario: An org admin reaches the dashboard
    When the admin navigates to "/settings/governance"
    Then the page renders with the heading "Governance Overview"
    And the URL stays at "/settings/governance"

  @bdd @ui @admin-oversight @feature-flag
  Scenario: Without the governance preview flag the page is hidden
    Given the feature flag "release_ui_ai_governance_enabled" is disabled
    When the admin navigates to "/settings/governance"
    Then the page renders the standard NotFoundScene (default-off for
      non-flagged orgs)
    And no telemetry is emitted that reveals the page exists

  # ---------------------------------------------------------------------------
  # Top summary cards (cross-cutting org totals)
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @summary
  Scenario: Top of the page shows three org-wide summary cards
    When the dashboard renders for an org with traffic
    Then there is a "Spent this month" card with USD total + month-over-month delta
    And a "Active AI users this month" card with count + new-users-this-week sub-line
    And a "Anomaly alerts (open)" card with count + severity breakdown

  @bdd @ui @admin-oversight @summary @empty
  Scenario: Empty-state copy when no traffic this month
    Given the organization has zero traces / no ingestion sources / no
      personal VKs issued yet
    When the dashboard renders
    Then the spend card reads "$0.00 / no AI traffic yet"
    And the users card reads "0 / nobody has used AI yet"
    And the anomaly card reads "0 / nothing to alert on"
    And below the cards a tile prompts "Connect a provider, enable a
      RoutingPolicy, or set up an IngestionSource to start collecting data"
    And the prompt links to /settings/model-providers,
      /settings/routing-policies, /settings/governance/ingestion-sources

  # ---------------------------------------------------------------------------
  # Per-user breakdown
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @per-user
  Scenario: A "By user" section lists every user's AI spend this month
    When the dashboard renders for an org with N active users
    Then a "By user" section shows a table of:
      | column                | sortable | default sort |
      | User                  | yes      |              |
      | Spend this month      | yes      | desc         |
      | Requests this month   | yes      |              |
      | Last activity         | yes      |              |
      | Trend vs last month   | yes      |              |
      | Most-used model       | no       |              |
    And each row links to a per-user drill-down at
      "/settings/governance/users/<userId>" (route wiring follows in a
      sibling slice; v0 link can be a no-op)

  @bdd @ui @admin-oversight @per-user @permissions
  Scenario: Per-user rows respect the admin's RBAC scope
    Given the admin has "organization:manage" but only on org "miro"
    When the dashboard renders
    Then only users in "miro" appear in the table
    And users from sibling orgs (where the admin has no permission) are
      not listed

  # ---------------------------------------------------------------------------
  # Anomaly alerts list
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @anomalies
  Scenario: An "Active anomaly alerts" section lists open alerts (newest first)
    When the dashboard renders for an org with K open alerts
    Then a section shows the alerts in a list, newest first, each with:
      | field          | description                                    |
      | severity       | "critical" / "warning" / "info" + color chip   |
      | rule           | the rule name that fired (e.g. "weekend spike")|
      | source         | the IngestionSource OR Gateway VK that fired   |
      | detected at    | relative + absolute timestamp                  |
      | current state  | "open" / "acknowledged" / "resolved"           |
    And each alert has an "Investigate" link that opens the alert detail
      drawer (drawer wiring follows in a sibling slice; v0 can be a no-op)

  @bdd @ui @admin-oversight @anomalies @empty
  Scenario: Empty-state for anomalies
    Given there are no open alerts
    When the dashboard renders
    Then the anomalies section reads "All quiet — no active alerts."
    And no list is rendered

  # ---------------------------------------------------------------------------
  # IngestionSource health strip
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @ingestion-health
  Scenario: A "Ingestion sources" health strip shows status of each
    Given the org has IngestionSources configured
    When the dashboard renders
    Then a horizontal strip shows one chip per source with:
      | field        | description                              |
      | name         | "Miro Cowork", "Workato Production", etc. |
      | sourceType   | otel_generic / workato / claude_cowork ... |
      | status       | "healthy" / "degraded" / "stale" / "down"  |
      | last event   | relative timestamp                         |
    And clicking a chip navigates to that source's detail page at
      "/settings/governance/ingestion-sources/<sourceId>" (link wiring
      follows in a sibling slice)

  @bdd @ui @admin-oversight @ingestion-health @empty
  Scenario: Empty-state when no IngestionSources are configured yet
    Given the org has zero IngestionSources
    When the dashboard renders
    Then the strip reads "No ingestion sources configured." with a CTA
      "+ Add your first source" linking to
      "/settings/governance/ingestion-sources/new"

  # ---------------------------------------------------------------------------
  # Mocked-data caveat (for v0; real-data wire-up follows D2)
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @mocked-v0
  Scenario: v0 ships with deterministic mock data (admins see a "Preview" badge)
    When the dashboard renders in v0 (release_ui_ai_governance_enabled is
      on but the backend D2 aggregation queries don't exist yet)
    Then the page header has a "Preview · mocked data" badge to set
      expectations
    And every section is populated from a deterministic in-memory fixture
      so admins can evaluate the UX without seeding traffic
    And the badge disappears once D2 cross-source aggregation lands and
      the page switches to live tRPC queries

  # ---------------------------------------------------------------------------
  # Accessibility
  # ---------------------------------------------------------------------------

  @bdd @ui @admin-oversight @a11y
  Scenario: All interactive elements are keyboard-operable
    When the admin tabs through the page
    Then every card / row link / chip can receive focus
    And focus rings are visible
    And screen readers announce section headings as <h2>

  @bdd @ui @admin-oversight @a11y
  Scenario: The anomaly section uses aria-live="polite"
    Given the admin keeps the page open while an alert fires server-side
    When the new alert arrives via tRPC poll / websocket (future iter)
    Then the anomaly section's container has role="status" + aria-live="polite"
      so the new alert is announced without stealing focus
