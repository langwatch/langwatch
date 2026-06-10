Feature: Governance home — route, nav promotion, persona detection
  The governance product surface lives at top-level `/governance` (a
  daily-use org-scoped home) — NOT under Settings. The legacy URL
  `/settings/governance` continues to render the same dashboard as a
  back-compat alias during the transition. Admin-authoring sub-routes
  (`/settings/governance/ingestion-sources*`, `/anomaly-rules`,
  `/settings/routing-policies`) stay under Settings since they are
  configuration surfaces, not daily-use dashboards.

  A `Governance` entry surfaces in the MainMenu sidebar ONLY for org
  admins whose org has actual governance state. Vast-majority current
  LLMOps users (no personal VKs / no IngestionSources / no governance
  flag) see no nav change — protecting the "don't lose LLMOps" invariant
  per @rchaves's iter-12 feedback.

  Background:
    Given the feature flag "release_ui_ai_governance_enabled" is enabled
      for the organization
    And the user has the "organization:manage" permission

  # ---------------------------------------------------------------------------
  # Route — top-level + back-compat alias
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @route
  Scenario: Top-level /governance renders the dashboard
    When the admin navigates to "/governance"
    Then the page renders with the heading "Governance"
    And the URL stays at "/governance"
    And the same setup-checklist OR live-metrics view shown at
      "/settings/governance" is rendered

  @bdd @ui @governance-home @route @alias
  Scenario: Legacy /settings/governance keeps working as alias
    When the admin navigates to "/settings/governance"
    Then the page renders the same dashboard component
    And no 404 is shown
    And admins who bookmarked the legacy URL during the preview can
      keep using it during the transition

  @bdd @ui @governance-home @route @sub-routes
  Scenario: Admin-authoring sub-routes stay under /settings/governance
    Then "/settings/governance/ingestion-sources" remains the list page
    And "/settings/governance/ingestion-sources/<id>" remains the
      per-source detail page
    And "/settings/governance/anomaly-rules" remains the rule
      authoring surface
    And "/settings/routing-policies" remains the routing-policy
      authoring surface
    # These are admin-config surfaces by design; the daily-use dashboard
    # at /governance links into them.

  # ---------------------------------------------------------------------------
  # Persona / nav promotion via api.governance.setupState
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @nav-promotion
  Scenario: Org admin with governance state sees the Governance nav entry
    Given the org has at least one of: personal VK, RoutingPolicy,
      IngestionSource, AnomalyRule, recent gateway event activity
    When the admin loads any project page
    Then the MainMenu sidebar shows a "Govern · Preview" section header
    And below it a "Governance" entry with an Eye icon
    And the entry links to "/governance"
    And the entry highlights as active when the URL is "/governance" OR
      "/settings/governance" OR any "/settings/governance/*" sub-route

  @bdd @ui @governance-home @nav-promotion @no-state
  Scenario: Org admin with NO governance state sees no nav change
    Given the org has zero personal VKs, RoutingPolicies,
      IngestionSources, AnomalyRules, AND no recent gateway activity
    When the admin loads any project page
    Then NO "Govern" section header appears in the sidebar
    And NO "Governance" entry is rendered
    And the existing project-scoped LLMOps menu is unchanged
    # This protects the "don't lose LLMOps" invariant: admins who
    # haven't configured governance see exactly main's nav.

  @bdd @ui @governance-home @nav-promotion @rbac
  Scenario: Non-admins never see the Governance entry
    Given the org has IngestionSources configured (governanceActive=true)
    But the current user does NOT have "organization:manage" permission
    When the user loads any project page
    Then NO "Govern" section header or "Governance" entry appears
    # Setup-state being true is necessary but not sufficient — the
    # nav entry is org-admin-only.

  @bdd @ui @governance-home @nav-promotion @flag
  Scenario: Without the governance preview flag, no nav entry appears
    Given "release_ui_ai_governance_enabled" is disabled for the org
    Even though the org has IngestionSources + the user is org admin
    Then NO "Govern" section header or "Governance" entry appears
    # All three conditions (flag + permission + state) are required.

  # ---------------------------------------------------------------------------
  # No auto-redirect (master_orchestrator's invariant)
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @no-auto-redirect
  Scenario: Hitting "/" never auto-redirects to /governance
    Given the admin has governanceActive=true
    When they navigate to "/"
    Then the existing project-pick / org-default routing applies
    And they are NOT auto-redirected to "/governance"
    # Governance is a nav promotion, not a forced home. Admins can
    # discover it via the sidebar; auto-redirect would be too
    # aggressive and would surprise project-only LLMOps admins.

  # ---------------------------------------------------------------------------
  # api.governance.setupState contract
  # ---------------------------------------------------------------------------

  @bdd @api @governance-home @setup-state
  Scenario: setupState returns boolean OR for nav-promotion signal
    When the admin's session resolves and the MainMenu calls
      `api.governance.setupState({organizationId})`
    Then the response shape is:
      | field                | type    | meaning                                   |
      | hasPersonalVKs       | boolean | any non-archived personal VK in org       |
      | hasRoutingPolicies   | boolean | any RoutingPolicy in org                  |
      | hasIngestionSources  | boolean | any non-archived IngestionSource in org   |
      | hasAnomalyRules      | boolean | any non-archived AnomalyRule in org       |
      | hasRecentActivity    | boolean | any gateway_activity_event in last 30d    |
      | governanceActive     | boolean | OR of the five hasFoo flags above         |
    And the procedure is org:view (any org member can call it; the
      org-admin permission gate applies to the nav-promotion decision
      in the UI, not to the read itself)
    And the query is cheap (small index lookups + a single
      gateway_activity_events count); MainMenu reads it on every
      page load with `refetchOnWindowFocus: false`

  # ---------------------------------------------------------------------------
  # Layout — current + future
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @layout
  Scenario: /governance renders with the GovernanceLayout (top-level chrome)
    When the admin loads "/governance"
    Then the page renders inside GovernanceLayout — NOT SettingsLayout
    And the header replaces the per-project ProjectSelector with an
      org-name chip + "Organization-scoped — not tied to a project"
      indicator (governance is org-scoped, not project-scoped)
    And the left rail shows a "GOVERNANCE" section header with these
      sub-routes:
      | label             | href                                          |
      | Overview          | /governance                                   |
      | Ingestion Sources | /settings/governance/ingestion-sources        |
      | Anomaly Rules     | /settings/governance/anomaly-rules            |
      | Routing Policies  | /settings/routing-policies                    |
    And a footer note explains that sub-pages are admin-config surfaces
      under Settings, while Overview is the daily-use home

  @bdd @ui @governance-home @layout @sub-routes
  Scenario: Admin-authoring sub-routes keep SettingsLayout chrome
    When the admin clicks "Ingestion Sources" in the GovernanceLayout
      left rail and lands on "/settings/governance/ingestion-sources"
    Then the page renders inside SettingsLayout (same chrome as every
      other Settings page) — NOT GovernanceLayout
    And the same applies to "/settings/governance/anomaly-rules" and
      "/settings/routing-policies"
    # GovernanceLayout owns the daily-use home only. Admin-config
    # surfaces stay under Settings because they're configuration
    # entities, not dashboards.

  @bdd @ui @governance-home @layout @bypass-project-redirect
  Scenario: /governance bypasses the no-project onboarding redirect
    Given an admin whose org has no projects yet
    When they navigate to "/governance"
    Then the GovernanceLayout renders without bouncing them to
      project-onboarding (DashboardLayout's `orgScope` flag bypasses
      the `redirectToProjectOnboarding` gate, same effect as
      `personalScope` for `/me/*` routes)
    And the org-name chip + indicator render correctly even with
      project=null
