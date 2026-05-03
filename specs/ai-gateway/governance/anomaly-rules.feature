Feature: AI Gateway Governance — Anomaly Rules (admin authoring)
  As an organization admin (Persona 3 from gateway.md), I author the
  anomaly rules that the detection reactor evaluates against the
  activity-monitor event stream. What counts as "weird" varies per
  organization — admins encode their own thresholds + scopes +
  destinations rather than living with hardcoded one-size-fits-all rules.

  This page is the authoring surface for AnomalyRule rows; their
  firings (`AnomalyAlert` rows) are produced by the detection reactor
  and surface on `/governance` (admin oversight dashboard's "Active
  anomaly alerts" section). One rule = one named threshold + scope +
  destination tuple.

  Scope boundary:
    THIS spec covers rule CRUD (the config entity authoring UI +
    `api.anomalyRules.*` mutations). Evaluation, firing semantics, and
    dispatch contracts live in `anomaly-detection.feature` — that is
    Sergey's event-sourcing reactor pattern (PR #3351 alignment per
    rchaves's "event sourcing is the one true way" directive). When
    these specs disagree on field shapes, the detection feature is
    canonical because it owns the reactor's input contract.

  Current ship state (as of iter 18):
    - api.anomalyRules.{list, create, update, archive} are LIVE — rule
      rows persist to the AnomalyRule table.
    - C1 (activity-monitor pipeline) + C2 (anomaly detection reactor +
      AnomalyAlert producer for spend_spike) ARE LIVE. End-to-end
      dogfood proven on 2026-04-27: rule planted → events fired →
      reactor evaluated → AnomalyAlert persisted → /governance
      "Recent anomalies" section renders the alert.
    - C3 (Slack / SIEM / webhook / PagerDuty / email dispatch) ships in
      a follow-up — current alerts dispatch log-only.
    - The earlier "Heads up: rules persist now…" honest-state banner
      was removed in iter 18 — evaluation works.

  Background:
    Given the feature flag "release_ui_ai_governance_enabled" is enabled
      for the organization
    And the user has the "organization:manage" permission

  # ---------------------------------------------------------------------------
  # Page scaffold + permission gate
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @permission
  Scenario: A non-admin user is redirected away from the rules page
    Given a user without "organization:manage" is signed in
    When they navigate to "/settings/governance/anomaly-rules"
    Then they are redirected (or shown the existing settings-permission
      "Not allowed" page)

  @bdd @ui @anomaly-rules @permission
  Scenario: An org admin reaches the rules page
    When the admin navigates to "/settings/governance/anomaly-rules"
    Then the page renders with the heading "Anomaly Rules"
    And the URL stays at "/settings/governance/anomaly-rules"

  @bdd @ui @anomaly-rules @feature-flag
  Scenario: Without the governance preview flag the page is hidden
    Given the feature flag "release_ui_ai_governance_enabled" is disabled
    When the admin navigates to "/settings/governance/anomaly-rules"
    Then the page renders the standard NotFoundScene
    And no telemetry is emitted that reveals the page exists

  # ---------------------------------------------------------------------------
  # No honest-state banner (C2 shipped iter 18 — evaluation is live)
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @no-honest-state-banner
  Scenario: Page no longer shows the "evaluation pending" banner
    When the page renders post-iter-18 (C2 reactor is live)
    Then no "Heads up: rules persist now…" banner is shown
    And no "Preview · mocked data" badge is shown
    And the page reads as fully-live: rules persist, the reactor
      evaluates, AnomalyAlert rows are produced, and dispatched at
      least to log-only (C3 will add Slack / SIEM / webhook / PagerDuty
      / email)

  # ---------------------------------------------------------------------------
  # Rule list grouped by severity (real api.anomalyRules.list data)
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @list
  Scenario: Rules group by severity (critical first)
    Given the org has authored rules across all three severities
    When the page calls `api.anomalyRules.list({organizationId})` and renders
    Then the rules are grouped into three sections in this order:
      | severity | tone   |
      | critical | red    |
      | warning  | amber  |
      | info     | blue   |
    And each section shows a count + "+ New rule" CTA
    And each rule row shows: name, rule type, scope + scopeId, destination
      summary, status (active / disabled / archived)

  @bdd @ui @anomaly-rules @list @empty
  Scenario: Empty-state when no rules are defined
    Given `api.anomalyRules.list` returns an empty array
    When the page renders
    Then a top-level prompt reads "No anomaly rules yet — create your
      first rule below"
    And the inline composer is visible without needing to click "+ New rule"

  # ---------------------------------------------------------------------------
  # Rule composer — wired to api.anomalyRules.create
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @composer @real-create
  Scenario: Admin authors a new rule via the live mutation
    When the admin clicks "+ New rule" in any severity section
    Then an inline composer expands inline below the section header with
      these fields (shape aligned to anomaly-detection.feature, which
      owns the reactor's input contract):
      | field             | type                 | description                          |
      | name              | text                 | display name                         |
      | severity          | enum                 | critical / warning / info            |
      | ruleType          | text + datalist      | spend_spike / after_hours / ...      |
      | scope             | enum                 | organization / team / project / source_type / source |
      | scopeId           | text                 | ID at the chosen scope (where applicable) |
      | thresholdConfig   | JSON textarea        | rule-type-specific config (JSONB)    |
      | destinationConfig | JSON textarea        | webhook / slack / log-only (JSONB)   |
    And submitting the composer calls `api.anomalyRules.create(...)`
    And on success the new rule row appears at the top of the matching
      severity section
    And on validation error the field-level message is surfaced inline
    And ruleType is open-enum (text + datalist) so admins aren't blocked
      when the reactor adds new rule types between releases

  @bdd @ui @anomaly-rules @composer @threshold-shape
  Scenario: thresholdConfig examples are documented inline per rule type
    Given the composer is open and ruleType="spend_spike"
    Then a help affordance shows the v1 spend_spike shape:
      """
      {
        "windowSec": 86400,
        "ratioVsBaseline": 2.0,
        "minBaselineUsd": 10
      }
      """
    When the admin selects ruleType="after_hours"
    Then the help affordance updates to the after_hours shape:
      """
      {
        "startHour": 18,
        "endHour": 6,
        "timezone": "UTC",
        "requestsThreshold": 100,
        "windowSec": 3600
      }
      """
    # Authoritative shapes live in anomaly-detection.feature — that's
    # the reactor's input contract. The UI mirrors them as guidance only.

  # ---------------------------------------------------------------------------
  # Per-rule actions — wired to api.anomalyRules.update / archive
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @actions @real-update
  Scenario: Admin disables a rule without archiving it
    Given an active rule "Weekend spend spike" exists
    When the admin toggles its enabled-switch off
    Then `api.anomalyRules.update({id, status: "disabled"})` is called
    And on success the row dims and shows a "Disabled" badge
    And the disabled rule is skipped by the detection reactor
      (see anomaly-detection.feature: "disabled rules are not evaluated")
    And re-enabling it does NOT replay missed events (forward-only
      semantics — confirmed in the detection reactor spec)

  @bdd @ui @anomaly-rules @actions @real-update
  Scenario: Admin edits an existing rule
    Given a rule exists
    When the admin clicks "Edit" on its row
    Then the composer pre-fills with the rule's current values
    And on save `api.anomalyRules.update(...)` is called with the
      changed fields only
    And the row updates inline with the new values

  @bdd @ui @anomaly-rules @actions @real-archive
  Scenario: Admin archives a rule with confirmation
    When the admin clicks the archive icon on a rule row
    Then a confirmation modal warns: "Archive rule 'X'? Existing alert
      firings remain in the audit log; the rule stops evaluating."
    And on confirm `api.anomalyRules.archive({id})` is called
    And the rule disappears from the active list (still queryable
      via list filter status="archived" for audit)
    And the detection reactor stops considering this rule on the next
      event append

  # ---------------------------------------------------------------------------
  # Tenant isolation
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @tenant-isolation
  Scenario: Rules from other orgs are never visible
    Given two orgs each have authored rules
    When admin of org A loads "/settings/governance/anomaly-rules"
    Then `api.anomalyRules.list` returns ONLY org A's rules
    And no rule belonging to org B is queryable from the org A session
      (enforced by the existing org-scoped procedure pattern; the
      AnomalyRule model is in EXEMPT_MODELS for projectId middleware
      because rules are organization-scoped, not project-scoped)

  # ---------------------------------------------------------------------------
  # Cross-page wiring
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @cross-page
  Scenario: Each anomaly on /governance links to its source rule
    Given the admin oversight dashboard shows AnomalyAlert rows produced
      by the detection reactor
    When the admin clicks an alert row's rule name
    Then the browser navigates to
      "/settings/governance/anomaly-rules?ruleId=<id>" and that rule's
      row is auto-scrolled into view + briefly highlighted

  # ---------------------------------------------------------------------------
  # Test/dogfood harness — proxied to anomaly-detection.feature
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @evaluate-now
  Scenario: "Test rule" button uses the production reactor (no parallel poller)
    Given the admin has authored a new rule
    When they click "Test rule" on its row
    Then the UI calls `api.anomalyRules.evaluateNow({id})`
    And per anomaly-detection.feature, that endpoint appends a synthetic
      ActivityEventReceived to the event_log against the rule's scope —
      the production reactor evaluates it identically to a real ingest
    And the result toasts "Test fired (alert <id>)" or "No threshold
      breach with current data"
    # NOTE: this is explicitly NOT a parallel evaluation pathway — it
    # exercises the same reactor that real events go through. Owned by
    # anomaly-detection.feature; mirrored here for UI completeness.

  # ---------------------------------------------------------------------------
  # Accessibility
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @a11y
  Scenario: Severity sections are properly headered for screen readers
    When the admin tabs through the page
    Then each severity section is wrapped in <section role="region">
      with an accessible name like "Critical anomaly rules (3)"
    And the inline composer's form fields all have <label> associations
