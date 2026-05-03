Feature: AI Gateway Governance — UI Contract (Lane B)
  Lane-B-owned UI invariants for the governance surface, written
  against the locked architecture (rchaves + master_orchestrator,
  2026-04-27): unified observability substrate (recorded_spans +
  log_records) with IngestionSource as origin metadata, hidden
  internal Governance Project per org as routing/tenancy artifact
  only, governance fold projections for derived KPIs/OCSF reads,
  per-origin retention class on the unified store, cryptographic
  tamper-evidence DEFERRED.

  This spec captures what the customer/admin sees in the UI and
  what they must NEVER see. Lane-A (Andre) owns the broader
  architecture/compliance/per-platform-mapping specs. Lane-S
  (Sergey) owns the backend specs (folds, retention, event-log,
  receiver shapes). This file is the UI contract that constrains
  Lane-B implementation work after Sergey's data-layer cutover
  lands.

  Pairs with:
    - specs/ai-gateway/governance/unified-trace-substrate.feature   (Andre)
    - specs/ai-gateway/governance/governance-folds.feature           (Sergey)
    - specs/ai-gateway/governance/per-origin-retention.feature       (Sergey)
    - specs/ai-gateway/governance/compliance-baseline.feature        (Andre)
    - specs/ai-gateway/governance/siem-ocsf-export.feature           (Andre)
    - specs/ai-gateway/governance/anomaly-detection.feature          (Sergey, updated)

  Background:
    Given user "admin@acme.com" is signed in to organization "acme"
    And the user has the "organization:manage" permission
    And the feature flag "release_ui_ai_governance_enabled" is enabled
    And Sergey's data-layer cutover has landed (api.activityMonitor.*
      procedures read from governance_kpis fold + recorded_spans/log_records
      with origin filter)

  # ---------------------------------------------------------------------------
  # Single governance surface — no traces-vs-logs distinction in UX
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @single-surface
  Scenario: /governance dashboard renders ONE unified events feed
    When the admin navigates to "/governance"
    Then the page renders with the heading "Governance Overview"
    And there is a single events feed (not separate "Traces" and "Logs"
      tabs/sections)
    And the customer's mental model is "events from this organization's
      ingestion sources" — the OTel traces-vs-logs distinction is
      NEVER surfaced in copy, headings, navigation, or filters

  @bdd @ui @ui-contract @single-surface
  Scenario: Per-source detail page renders ONE unified events feed
    Given an IngestionSource "Cowork Production" exists
    When the admin navigates to "/settings/governance/ingestion-sources/<id>"
    Then the page renders the source's metadata (name, type, status,
      retention class, recent volume)
    And the events tab below renders a single events feed mixing
      span-shape and log-shape rows from this source
    And no UI surface differentiates "this row is a span" vs "this row
      is a log record" to the user
    And the empty-state copy reads "No events from this source yet"
      (shape-neutral — does not pre-commit to spans OR logs)

  # ---------------------------------------------------------------------------
  # Shape-aware click-through — internal routing, transparent to user
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @drill-down
  Scenario: Clicking a span-shape event row routes to the trace viewer
    Given the events feed contains a row whose underlying record is a
      span (e.g. a Cowork tool_use span emitted via /api/ingest/otel/<id>)
    When the admin clicks that row
    Then the UI navigates to the existing LangWatch trace viewer
      scoped to that span's trace_id
    And the trace viewer renders inside the unified observability
      substrate the customer already knows (input/output messages, tool
      tree, eval scores, etc.) — NOT a bespoke "audit event detail"
      page

  @bdd @ui @ui-contract @drill-down
  Scenario: Clicking a log-shape event row routes to the log-detail pane
    Given the events feed contains a row whose underlying record is a
      log (e.g. a Workato webhook completion event mapped to OTLP logs)
    When the admin clicks that row
    Then the UI navigates to the existing log_records detail pane
      (or its extension for governance-origin logs) scoped to that
      log record's id
    And the log-detail pane renders inside the unified observability
      substrate (attributes, severity, trace context if any, body)
    And NO separate governance-event renderer is built — this is a
      filtered view over the existing log-records UI

  @bdd @ui @ui-contract @drill-down @uniformity
  Scenario: The user cannot tell from the events feed which row will
            route to which destination
    When the admin scrolls the events feed
    Then every row shows the same columns (timestamp, source, actor,
      action, target, cost, tokens, severity)
    And no badge / icon / typography differentiates spans from logs
    And the routing decision (trace viewer vs log-detail pane) is
      determined internally by the row's record type, transparently
      to the user

  # ---------------------------------------------------------------------------
  # Hidden internal Governance Project — invisible at every consumer
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @hidden-project @critical
  Scenario: The hidden Governance Project never appears in the
            ProjectSelector dropdown
    Given the org has at least one IngestionSource (so the hidden
      Governance Project has been auto-created)
    When the admin opens the ProjectSelector dropdown anywhere in
      the UI (top nav, settings sidebar, model providers, etc.)
    Then the dropdown lists only Projects with kind != "internal_governance"
    And the hidden Governance Project is NEVER an option
    And the dropdown count matches the count of user-visible projects
      (the hidden project is not counted)

  @bdd @ui @ui-contract @hidden-project @critical
  Scenario: The hidden Governance Project never appears in
            /api/v1/projects responses
    When any client (UI, CLI, customer integration) calls
      GET /api/v1/projects with a token scoped to the org
    Then the response body lists only Projects with kind != "internal_governance"
    And the hidden Governance Project is NEVER returned
    And no metadata field hints at its existence (no count delta,
      no opaque ID reference, no error condition revealing it)

  @bdd @ui @ui-contract @hidden-project @critical
  Scenario: The hidden Governance Project never appears in billing
            exports or invoice line-items
    When the org's monthly billing export is generated
    Then per-Project rollup lines list only Projects with
      kind != "internal_governance"
    And the unified-store usage attributable to the hidden Governance
      Project is folded into the org-level total (NOT a separate line
      item that would reveal the hidden project's existence)

  @bdd @ui @ui-contract @hidden-project @critical
  Scenario: The hidden Governance Project never appears in RBAC role
            binding pickers
    When an admin opens any RBAC role-binding composer
      (RoleBinding scope picker, custom role assignments, project ACL UI)
    Then the project picker lists only Projects with
      kind != "internal_governance"
    And the hidden Governance Project is NEVER an option
    And RBAC for governance data is enforced via the
      org-admin/auditor-role membership on the hidden project (set
      by Sergey's backend at IngestionSource mint), NOT via UI-visible
      role binding flows

  @bdd @ui @ui-contract @hidden-project @critical
  Scenario: The hidden Governance Project never appears in any other
            user-visible Project surface
    When any UI component renders a Project (badge, dropdown, list,
      breadcrumb, search result, deep link target)
    Then it filters out kind == "internal_governance" rows
    And any leak of the hidden project to a user surface is treated
      as a bug (regression test in
      langwatch/src/components/__tests__/projectFilter.invariant.test.ts
      asserts every Project consumer applies the filter)

  # ---------------------------------------------------------------------------
  # IngestionSource composer — no project picker (per master directive)
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @composer @critical
  Scenario: The IngestionSource composer does NOT show a Project
            selection field
    When the admin opens the "Create ingestion source" composer at
      "/settings/governance/ingestion-sources/new"
    Then the composer asks for: name, source type, per-platform config,
      retention class
    And the composer does NOT ask the admin to select or assign a
      Project (the hidden Governance Project routing is done by the
      backend; it is never a user-facing field)
    And the composer does NOT mention "Governance Project" or
      "internal_governance" in any user-visible label, helper text,
      or tooltip

  @bdd @ui @ui-contract @composer @retention
  Scenario: The IngestionSource composer offers a retention class dropdown
    When the admin opens the "Create ingestion source" composer
    Then the composer renders a "Retention class" dropdown with options:
      | option label                                          | value      |
      | Operational (30 days)                                 | 30d        |
      | Compliance (1 year)                                   | 1y         |
      | Long-term audit (7 years, SOC2 / HIPAA / regulated)   | 7y         |
    And the dropdown ceiling is enforced by the org's plan tier
      (e.g. Free tier sees only "Operational"; Enterprise sees all three)
    And the default selection is "Operational (30 days)"
    And helper text reads "Determines how long events from this source
      are retained on the LangWatch unified observability store."

  # ---------------------------------------------------------------------------
  # Reserved namespace — langwatch.governance.* is system-derived
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @namespaces @critical
  Scenario: The UI never accepts user-supplied langwatch.governance.* attributes
    When any composer (anomaly rule, IngestionSource, custom attribute)
      asks the admin for span/log attributes
    Then the UI rejects (with inline error) any attribute whose key
      starts with "langwatch.governance."
    And helper text reads "The langwatch.governance.* namespace is
      reserved for system-derived attributes (anomaly_alert_id,
      retention_class, etc.) and cannot be set by users."
    And langwatch.origin.* attributes are also reserved (same UX,
      same helper text), set by the receiver layer, not by users

  @bdd @ui @ui-contract @namespaces
  Scenario: The events feed displays langwatch.origin.* and
            langwatch.governance.* as system-derived (read-only)
    When the events feed renders an event row's expanded attributes
    Then attributes in the langwatch.origin.* and langwatch.governance.*
      namespaces are visually grouped under a "System metadata"
      collapsible section
    And the System metadata section is read-only (no edit affordance)
    And user-supplied span/log attributes are grouped under "Attributes"
      separately

  # ---------------------------------------------------------------------------
  # OTLP body-shape examples in the modal — match wire shape per source type
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @copy @composer
  Scenario: The post-create secret modal shows the right OTLP shape per source type
    Given the admin just created an IngestionSource of type "otel_generic"
    When the SecretModal renders the "OTLP ingestion endpoint" section
    Then the body-shape example shows OTLP TRACES JSON
      (resource_spans → scope_spans → spans with startTimeUnixNano)
    And the helper text reads "Push OTLP traces to this endpoint to
      have spans ingested into the LangWatch trace store with this
      source's origin tag."

  @bdd @ui @ui-contract @copy @composer
  Scenario: The post-create secret modal shows OTLP logs body for log-shape source types
    Given the admin just created an IngestionSource of type "workato"
      (or s3_custom / openai_compliance / claude_compliance / copilot_studio)
    When the SecretModal renders the "OTLP ingestion endpoint" section
    Then the body-shape example shows OTLP LOGS JSON
      (resource_logs → scope_logs → log_records with timeUnixNano,
       severityNumber, severityText, body, attributes)
    And the helper text reads "Push OTLP log records to this endpoint
      to have events ingested into the LangWatch log store with this
      source's origin tag."

  @bdd @ui @ui-contract @copy @disambiguation
  Scenario: Both modals link to the disambiguation docs page
    When the SecretModal renders for any source type
    Then below the body-shape example, a small caption reads
      "Spans/logs land in the LangWatch unified observability store
       with this source's origin tag and become viewable in the
       trace viewer or log-detail pane respectively. If you are
       sending agent traces from your own LangWatch SDK, use
       /api/otel/v1/traces with your project API key — different
       auth, same store."
    And the caption links to the disambiguation page at
      /observability/trace-vs-activity-ingestion (Andre's lane)

  # ---------------------------------------------------------------------------
  # Anomaly rule composer — scope picker still works post-rebase
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @anomaly-rules
  Scenario: The anomaly rule composer's scope picker still works against
            IngestionSource IDs after the cutover
    Given Sergey's anomaly reactor has rebased on governance_kpis fold
    When the admin opens the AnomalyRule composer at
      "/settings/governance/anomaly-rules/new"
    And selects scope = "source"
    Then the scope-id picker dropdown lists active IngestionSources
      by name + type (e.g. "Cowork Prod (claude_cowork)")
    And selecting one populates the rule's scopeId with the
      corresponding lw_is_<id> value
    And the rule fires when governance_kpis fold rows for that
      origin breach the threshold (Sergey's backend; this spec
      asserts only that the UI continues to function unchanged
      post-rebase)

  # ---------------------------------------------------------------------------
  # Empty states — copy is shape-neutral and consistent
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @empty-state
  Scenario: /governance dashboard empty state when no IngestionSource exists
    Given the org has zero IngestionSources
    When the admin navigates to "/governance"
    Then the page renders with the heading "Governance Overview"
    And a single CTA tile reads "Set up your first ingestion source
      to start collecting events from third-party AI platforms"
    And the CTA links to "/settings/governance/ingestion-sources/new"

  @bdd @ui @ui-contract @empty-state
  Scenario: Per-source detail empty state when source has no events yet
    Given the IngestionSource exists but has received zero events
    When the admin navigates to its detail page
    Then the events feed empty state reads "No events from this source yet"
    And below: "Push an OTLP body (traces or logs depending on source
      type) to <endpoint URL> with the source's bearer secret to
      start populating."
    And the OTLP body shape example matches the source's wire shape
      (traces for span-shape, logs for log-shape)

  # ---------------------------------------------------------------------------
  # Trace-viewer embed — replaces bespoke event renderer (Lane B post-cutover)
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @trace-viewer-embed
  Scenario: The per-source detail page embeds the existing trace
            viewer (does NOT build a bespoke event renderer)
    When the admin navigates to a per-source detail page with events
    Then the events feed reuses the existing
      langwatch/src/components/messages/MessagesList component
      (or the equivalent feed renderer used at /messages)
    And NO bespoke "EventsTable" / "GovernanceEventRow" component
      exists for governance — the existing components handle
      governance-origin events via origin filter, transparently
    And clicking a row routes per the shape-aware drill-down rules
      above (span → trace viewer, log → log-detail pane)

  # ---------------------------------------------------------------------------
  # Deferred items — explicitly NOT in this PR
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @deferred
  Scenario: Cryptographic tamper-evidence is NOT exposed in the UI
    When the admin navigates to any governance surface
    Then there is NO "Verify integrity" button, "Merkle root" display,
      "Audit signature" panel, or any other surface that claims
      cryptographic tamper-evidence
    And IF the org's contracts mention tamper-evidence, the docs
      explicitly direct them to the follow-up hardening layer
      (Andre's compliance-baseline.feature names this)

  # ---------------------------------------------------------------------------
  # Regression test invariants (codified for test discovery)
  # ---------------------------------------------------------------------------

  @bdd @ui @ui-contract @regression
  Scenario: Lane-B test suite asserts every Project consumer filters
            kind=internal_governance
    When the test suite runs
      langwatch/src/components/__tests__/projectFilter.invariant.test.ts
    Then it enumerates every component / API / hook / repository
      method that loads or renders Projects
    And for each, asserts that a Project with kind="internal_governance"
      is filtered out before reaching the user-visible surface
    And NEW Project consumers added in future PRs MUST extend this
      test (CI fails if a new Project consumer is added without an
      assertion)
