Feature: AI Gateway Governance — Anomaly Rules (admin authoring)
  As an organization admin (Persona 3 from gateway.md), I need to define
  the anomaly rules that fire alerts on the Activity Monitor — what
  counts as "weird" varies per organization and we should let admins
  encode their own thresholds + scopes + destinations rather than
  hardcoding a one-size-fits-all rule set.

  This page is the authoring surface for the rules whose firings show
  up on /settings/governance (the admin oversight dashboard's "Active
  anomaly alerts" section). One rule = one named threshold + scope +
  destination tuple.

  IMPORTANT — schema disclaimer:
    The rule schema captured here is **v0 placeholder**. The backend
    rule-evaluation slice (Sergey's Option C) may revise field shapes
    once server-side evaluation is implemented. The UI stays open-enum
    on rule type / severity / destination so the migration is
    mechanical when the contract is locked. Until that backend slice
    lands, this page renders MOCK_RULES fixtures only — no tRPC
    procedure is invoked.

  Iter-12 ships the UI gated behind release_ui_ai_governance_enabled
  with deterministic mock data + a "Preview · mocked data" badge in
  the header so admins can evaluate the UX. Real-data wire-up follows
  when api.anomalyRules.* exists.

  Background:
    Given user "platform-admin@miro.com" is signed in to organization "miro"
    And the user has the "organization:manage" permission
    And the feature flag "release_ui_ai_governance_enabled" is enabled

  # ---------------------------------------------------------------------------
  # Page scaffold + permission gate
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @permission
  Scenario: A non-admin user is redirected away from the rules page
    Given user "engineer@miro.com" is signed in but does NOT have
      "organization:manage"
    When she navigates to "/settings/governance/anomaly-rules"
    Then she is redirected (or shown the existing settings-permission
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
  # Mocked-v0 caveat
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @mocked-v0
  Scenario: v0 ships with deterministic mock data (no backend wire-up yet)
    When the page renders in v0 (release_ui_ai_governance_enabled is on but
      api.anomalyRules.* doesn't exist yet — Sergey's C-backend deferred)
    Then the page header has a "Preview · mocked data" badge
    And every rule row is populated from a deterministic in-memory fixture
    And clicking "+ New rule" opens an inline composer that does NOT
      submit to a backend (only updates local state); a banner reads
      "Rules persist once the anomaly-detection backend lands. v0 is a
      preview surface only."
    And the badge + banner disappear once the C-backend lands and the
      page switches to live tRPC mutations

  # ---------------------------------------------------------------------------
  # Rule list grouped by severity
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @list
  Scenario: Rules group by severity (critical first)
    When the page renders for an org with N defined rules
    Then the rules are grouped into three sections in this order:
      | severity | tone   |
      | critical | red    |
      | warning  | amber  |
      | info     | blue   |
    And each section shows a count + "+ New rule" CTA
    And each rule row shows: name, rule type, scope, destination, last
      fired (relative timestamp), enabled toggle

  @bdd @ui @anomaly-rules @list @empty
  Scenario: Empty-state when no rules are defined
    Given the org has zero anomaly rules
    When the page renders
    Then a top-level prompt reads "No anomaly rules yet — pick a starting
      template or create from scratch"
    And four template tiles offer 1-click rule creation:
      | template            | description                                 |
      | weekend-spend-spike | flag spending > 2x weekday avg on Sat/Sun  |
      | unusual-model       | flag any model outside the configured list  |
      | tool-policy-violation | flag any virtual key call to a blocked tool |
      | new-user-burst      | flag a brand-new user spending > $X in 24h |
    And clicking a tile pre-fills the composer with that template's defaults

  # ---------------------------------------------------------------------------
  # Rule composer
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @composer
  Scenario: Admin authors a new rule from scratch
    When the admin clicks "+ New rule" in the warning section
    Then an inline composer expands inline below the section header with
      these fields (v0 placeholder schema — see header disclaimer):
      | field        | type                 | description                        |
      | name         | text                 | display name                       |
      | severity     | enum                 | critical / warning / info          |
      | ruleType     | enum (open)          | spend-spike / unusual-model / ...  |
      | scopeType    | enum                 | org / team / project / user / source |
      | scopeId      | text or autocomplete | ID at the chosen scope             |
      | thresholdJson| JSON textarea        | rule-type-specific config          |
      | destinations | multi-checkbox       | slack / email / webhook / pagerduty|
    And submitting the composer (in v0) only adds the rule to local state
      and toasts "Rule saved (v0 — not persisted)"
    And the new rule appears at the top of the relevant severity section

  @bdd @ui @anomaly-rules @composer @threshold-json
  Scenario: thresholdJson editor explains shape per rule type
    Given the composer is open and ruleType="spend-spike"
    Then the thresholdJson editor pre-fills with the spend-spike shape:
      """
      {
        "windowSec": 86400,
        "ratioVsBaseline": 2.0,
        "minBaselineUsd": 10
      }
      """
    And a help link reads "Threshold config schema → spend-spike (docs)"
    When the admin selects ruleType="unusual-model"
    Then the thresholdJson editor swaps to the unusual-model shape:
      """
      {
        "allowedModelGlobs": ["gpt-5-*", "claude-3-*"]
      }
      """
    And the help link's docs target updates accordingly

  # ---------------------------------------------------------------------------
  # Per-rule actions
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @actions
  Scenario: Admin disables a rule without deleting it
    Given a rule "Weekend spend spike" exists, enabled
    When the admin toggles its enabled-switch off
    Then the rule row dims and shows "Disabled" badge
    And no new firings will register for this rule when re-enabled does
      NOT replay missed events (forward-only semantics)
    When the admin toggles the switch back on
    Then the rule resumes producing firings on subsequent matches

  @bdd @ui @anomaly-rules @actions
  Scenario: Admin edits an existing rule
    Given a rule "Weekend spend spike" exists
    When the admin clicks "Edit" on its row
    Then the composer pre-fills with the rule's current values
    And on save the row updates with the new field values
    And in v0 the change is local-only (toast: "edit saved — not persisted")

  @bdd @ui @anomaly-rules @actions
  Scenario: Admin deletes a rule with confirmation
    When the admin clicks the trash icon on a rule row
    Then a confirmation modal warns "Delete rule 'X'? Existing alert
      firings remain in the audit log."
    And on confirm the rule disappears from the list
    And in v0 the change is local-only

  # ---------------------------------------------------------------------------
  # Cross-page wiring
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @cross-page
  Scenario: Each anomaly on /settings/governance links to its rule
    Given the admin oversight dashboard shows alerts that fired
    When the admin clicks an anomaly row's rule name
    Then the browser navigates to
      "/settings/governance/anomaly-rules?ruleId=<id>" and that rule's
      row is auto-scrolled into view + briefly highlighted

  # ---------------------------------------------------------------------------
  # Accessibility
  # ---------------------------------------------------------------------------

  @bdd @ui @anomaly-rules @a11y
  Scenario: Severity sections are properly headered for screen readers
    When the admin tabs through the page
    Then each severity section is wrapped in <section role="region">
      with an accessible name like "Critical anomaly rules (3)"
    And the inline composer's form fields all have <label> associations
