Feature: Per-origin retention class on the unified observability store
  Application traces and governance audit data have different retention
  needs. Operational debugging traces are typically 30-90 days; SOC2 /
  HIPAA / EU AI Act audit data is typically 1-7 years. Forcing both into
  the same TTL would either balloon storage or violate compliance.

  Per-origin retention solves this WITHOUT splitting storage. Every
  span / log_record carries a `langwatch.governance.retention_class`
  attribute (set by the IngestionSource receiver from the source's
  config). ClickHouse TTL policy reads the attribute at delete time
  to apply the correct retention.

  Implementation: column on recorded_spans + log_records denormalised
  from the attribute at insert time (CH TTL doesn't read deeply nested
  Map columns efficiently). IngestionSource Prisma model gains a
  `retentionClass` field (enum: thirty_days | one_year | seven_years).

  Companion: receiver-shapes.feature, folds.feature.

  Background:
    Given the unified observability substrate is live
    And the org plan permits the requested retention ceiling

  Rule: retention class is configured per IngestionSource

    Scenario: admin selects a retention class on the source composer
      Given an admin is creating a new IngestionSource
      When the admin picks "1 year (compliance)" from the retention dropdown
      Then the IngestionSource row persists `retentionClass = one_year`
      And the secret-reveal modal does NOT show the retention class to the upstream caller
      And the receiver routes events through the hidden Governance Project (no project picker)

    Scenario: default retention class
      Given the admin does not change the dropdown
      Then `retentionClass` defaults to "thirty_days" (operational)

  Rule: retention class is stamped on every event the source emits

    Scenario: Cowork tenant push inherits source retention class
      Given an IngestionSource of type "claude_cowork" with `retentionClass = one_year`
      When Cowork pushes OTLP traces
      Then every span gains attribute `langwatch.governance.retention_class = one_year`
      And the denormalised retention class column on recorded_spans matches

    Scenario: Workato webhook inherits source retention class
      Given an IngestionSource of type "workato" with `retentionClass = seven_years`
      When Workato POSTs a recipe-completed envelope
      Then the resulting log_record gains the same `retention_class = seven_years` attribute
      And the denormalised column on log_records matches

  Rule: ClickHouse TTL policy enforces retention by class

    Scenario: 30-day operational data ages out at the end of the window
      Given a span landed 31 days ago with `retention_class = thirty_days`
      When CH TTL eval runs
      Then the span row is purged
      And no governance audit obligation is violated (it's not audit data)

    Scenario: 1-year compliance data persists past 30 days
      Given a span landed 60 days ago with `retention_class = one_year`
      When CH TTL eval runs
      Then the span row is retained
      And it remains queryable via /governance + the OCSF export

    Scenario: 7-year audit data persists past 1 year
      Given a span landed 18 months ago with `retention_class = seven_years`
      Then the span row is retained
      And the SOC2 / HIPAA / EU AI Act audit obligation is satisfied
        for the duration of the contractual retention period

  Rule: org plan ceiling enforces upper bound

    Scenario: free-tier org cannot select 7-year retention
      Given the org's plan permits up to "1 year" retention
      When an admin attempts to set `retentionClass = seven_years` on a source
      Then the create / update is rejected with a clear error
      And the dropdown UI hides retention options above the plan ceiling

    Scenario: enterprise plan permits all retention classes
      Given the org's plan permits up to "7 years"
      When an admin selects any retention class
      Then the IngestionSource persists with the requested class

  Rule: retention class is derived metadata, not user-facing per-event

    Scenario: customer-facing UI never exposes the retention class as user-supplied
      Given an admin opens the trace viewer on a governance-origin span
      When the span detail panel renders
      Then `langwatch.governance.retention_class` appears in the system-derived attributes section
      And it is NOT editable in the UI
      And it is NOT confused with user-supplied span attributes
