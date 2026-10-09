Feature: AI Gateway Governance — Anomaly Rules (admin authoring)
  As an organization admin (Persona 3 from gateway.md), I author the
  anomaly rules that the detection subscriber evaluates against the
  activity-monitor event stream. What counts as "weird" varies per
  organization — admins encode their own thresholds + scopes +
  destinations rather than living with hardcoded one-size-fits-all rules.

  This page is the authoring surface for AnomalyRule rows; their
  firings (`AnomalyAlert` rows) are produced by the detection subscriber
  and surface on `/governance` (admin oversight dashboard's "Active
  anomaly alerts" section). One rule = one named threshold + scope +
  destination tuple.

  Scope boundary:
    THIS spec covers rule CRUD (the config entity authoring UI +
    `api.anomalyRules.*` mutations). Evaluation, firing semantics, and
    dispatch contracts live in `anomaly-detection.feature` — that is
    Sergey's event-sourcing subscriber pattern (PR #3351 alignment per
    rchaves's "event sourcing is the one true way" directive). When
    these specs disagree on field shapes, the detection feature is
    canonical because it owns the subscriber's input contract.

  Current ship state (as of iter 18):
    - api.anomalyRules.{list, create, update, archive} are LIVE — rule
      rows persist to the AnomalyRule table.
    - C1 (activity-monitor pipeline) + C2 (anomaly detection subscriber +
      AnomalyAlert producer for spend_spike) ARE LIVE. End-to-end
      dogfood proven on 2026-04-27: rule planted → events fired →
      subscriber evaluated → AnomalyAlert persisted → /governance
      "Recent anomalies" section renders the alert.
    - C3 (Slack / SIEM / webhook / PagerDuty / email dispatch) ships in
      a follow-up — current alerts dispatch log-only.
    - The earlier "Heads up: rules persist now…" honest-state banner
      was removed in iter 18 — evaluation works.

  Background:
    Given the feature flag "release_ui_ai_governance_enabled" is enabled
      for the organization
    And the user has the "governance:view" permission
    And the user has the "anomalyRules:manage" permission

  # ---------------------------------------------------------------------------
  # Page scaffold + permission gate
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @permission
  Scenario: A user without the governance read grant is refused the rules page
    # The page gate is `governance:view`. A holder of it who lacks
    # `anomalyRules:view` reaches the page and is told which grant the rule
    # list needs, per
    # specs/ai-governance/rbac/delegated-governance-viewer.feature.
    Given a user without "governance:view" is signed in
    When they navigate to "/governance/anomaly-rules"
    Then they are shown the existing settings-permission "Access Restricted"
      page

  @bdd @ui @anomaly-rules @permission
  Scenario: An org admin reaches the rules page
    When the admin navigates to "/governance/anomaly-rules"
    Then the page renders with the heading "Anomaly Rules"
    And the URL stays at "/governance/anomaly-rules"

  @bdd @ui @anomaly-rules @feature-flag
  Scenario: Without the governance preview flag the page is hidden
    Given the feature flag "release_ui_ai_governance_enabled" is disabled
    When the admin navigates to "/governance/anomaly-rules"
    Then the page renders the standard NotFoundScene
    And no telemetry is emitted that reveals the page exists

  # ---------------------------------------------------------------------------
  # No honest-state banner (C2 shipped iter 18 — evaluation is live)
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @no-honest-state-banner
  Scenario: Page no longer shows the "evaluation pending" banner
    When the page renders post-iter-18 (C2 subscriber is live)
    Then no "Heads up: rules persist now…" banner is shown
    And no "Preview · mocked data" badge is shown
    And the page reads as fully-live: rules persist, the subscriber
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
      owns the subscriber's input contract):
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
      when the subscriber adds new rule types between releases

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
    # the subscriber's input contract. The UI mirrors them as guidance only.

  # ---------------------------------------------------------------------------
  # Per-rule actions — wired to api.anomalyRules.update / archive
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @actions @real-update
  Scenario: Admin disables a rule without archiving it
    Given an active rule "Weekend spend spike" exists
    When the admin toggles its enabled-switch off
    Then `api.anomalyRules.update({id, status: "disabled"})` is called
    And on success the row dims and shows a "Disabled" badge
    And the disabled rule is skipped by the detection subscriber
      (see anomaly-detection.feature: "disabled rules are not evaluated")
    And re-enabling it does NOT replay missed events (forward-only
      semantics — confirmed in the detection subscriber spec)

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
    And the detection subscriber stops considering this rule on the next
      event append

  # ---------------------------------------------------------------------------
  # Tenant isolation
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @tenant-isolation
  Scenario: Rules from other orgs are never visible
    Given two orgs each have authored rules
    When admin of org A loads "/governance/anomaly-rules"
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
      by the detection subscriber
    When the admin clicks an alert row's rule name
    Then the browser navigates to
      "/governance/anomaly-rules?ruleId=<id>" and that rule's
      row is auto-scrolled into view + briefly highlighted

  # ---------------------------------------------------------------------------
  # Test/dogfood harness — proxied to anomaly-detection.feature
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @evaluate-now
  Scenario: "Test rule" button uses the production subscriber (no parallel poller)
    Given the admin has authored a new rule
    When they click "Test rule" on its row
    Then the UI calls `api.anomalyRules.evaluateNow({id})`
    And per anomaly-detection.feature, that endpoint appends a synthetic
      ActivityEventReceived to the event_log against the rule's scope —
      the production subscriber evaluates it identically to a real ingest
    And the result toasts "Test fired (alert <id>)" or "No threshold
      breach with current data"
    # NOTE: this is explicitly NOT a parallel evaluation pathway — it
    # exercises the same subscriber that real events go through. Owned by
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

  Rule: A rule can deliver its alerts to a registered webhook endpoint (ADR-167)
    Request delivery Q1 to Q3 (rulings 2026-10-05). A destination `{ type: "webhook_endpoint",
    endpointId }` names one of the organisation's webhook endpoints. Governance records a deliver
    intent per alert and endpoint in its own outbox; the intent asks the webhook module for
    delivery under a key derived from the alert, so a retried intent delivers once. Inline
    `{ type: "webhook", url, sharedSecret }` destinations keep delivering as before until the plan
    gate (an organisation without webhook endpoints, or not entitled to them) is ruled.

    @unit
    Scenario: A rule delivering to a webhook endpoint records one deliver intent per alert
      Given an active spend_spike rule whose destination is a webhook endpoint
      When the rule fires an alert
      Then one deliver intent is recorded for that endpoint, keyed by the alert and the endpoint
      And nothing is posted inline

    @unit
    Scenario: A deliver intent asks the webhook module once per alert, however often it runs
      Given a recorded deliver intent for an alert
      When the intent runs twice
      Then each run requests delivery of a "governance.anomaly_alert.triggered" message
      And both requests carry the same idempotency key, so the webhook module delivers once

    @unit
    Scenario: An inline webhook destination keeps delivering as before
      Given an active rule whose destination is an inline webhook URL with a shared secret
      When the rule fires an alert
      Then the alert is posted to the URL signed "sha256=" as before
      And no deliver intent is recorded

    @integration
    Scenario: The rule form lists and saves one of the organisation's webhook endpoints
      Given an organisation with two webhook endpoints
      When an admin picks one for a rule's destination and saves
      Then the rule's destination names that endpoint by id

    @integration
    Scenario: The rule form keeps an inline webhook destination readable
      Given a rule whose destination is an inline webhook URL
      When an admin opens it in the rule form
      Then the form shows the URL the alerts post to
      And saving without picking an endpoint keeps the inline destination

    @integration
    Scenario: Without webhook endpoint read access the rule form shows a no-permission notice
      Given an admin who can manage anomaly rules but lacks "webhookEndpoints:view"
      When they open the rule form
      Then the destination field shows a no-permission notice naming "webhookEndpoints:view"
      And no webhook endpoints are requested

    @integration @unimplemented
    Scenario: Inline destinations are migrated to legacy-scheme webhook endpoints
      Given a rule with an inline webhook destination
      When the governance migration step runs, once or more than once
      Then one webhook endpoint on the legacy scheme exists for that URL and secret
      And the rule's destination names that endpoint

    @integration @unimplemented
    Scenario: An organisation that cannot hold webhook endpoints never loses an alert silently
      Given an organisation with anomaly rules but no webhook endpoints entitlement
      When an inline destination would be migrated
      Then its alerts keep reaching their receiver, or the admin is told before they stop

@unit @anomaly-rules @migration
Scenario: The destination migration run twice creates each endpoint once
  Given rules with inline webhook destinations in two organisations
  When the anomaly webhook destination migration runs twice
  Then each inline destination became one legacy-scheme endpoint signed with the rule's secret
  And each rule now names its endpoints, so the second run creates nothing

@unit @anomaly-rules @migration
Scenario: A dry run of the destination migration counts and changes nothing
  Given rules with inline webhook destinations in two organisations
  When the anomaly webhook destination migration runs as a dry run
  Then it reports the rules and endpoints it would move
  And no endpoint is created and no rule is rewritten

@unit @anomaly-rules @migration
Scenario: The destination migration resumes after its checkpoint
  Given the migration saved the first organisation as its checkpoint
  When the migration runs again from that checkpoint
  Then only the organisations after it are migrated
  And each completed page is saved as the next checkpoint

@unit @anomaly-rules @migration
Scenario: A rule edited while the destination migration runs keeps the edit
  Given a rule with an inline webhook destination
  And an admin changes the rule's destinations after the migration read it
  When the migration writes the rule
  Then the admin's destinations stay
  And the endpoint made from the rule as it was read is archived

@unit @anomaly-rules @migration
Scenario: A release rolled back after the destination migration still delivers each rule's alerts
  Given the destination migration has run on a rule with an inline webhook destination
  When an image older than the migration reads the rule
  Then it still finds the inline webhook URL and secret and delivers to them

@unit @anomaly-rules @migration
Scenario: A migrated inline destination delivers through its endpoint
  Given the destination migration gave a rule's inline webhook destination an endpoint
  When the rule fires an alert
  Then the alert is delivered through that endpoint
  And nothing is posted to the inline URL

@unit @anomaly-rules @migration
Scenario: A destination migration stopped between endpoint creation and the rule write makes no second endpoint
  Given the migration created an endpoint for a rule and stopped before writing the rule
  When the migration runs again
  Then the rule names that same endpoint and no other endpoint exists for it
