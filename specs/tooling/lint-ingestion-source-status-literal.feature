Feature: The ingestion-source-status-literal lint rule
  Whether an ingestion source takes events is decided once, by
  `ingestionSourceIsLive` and `ingestionSourceStatusIsOff` in the governance
  contract (`source-liveness.ts`). When the push receivers spelled it as "not
  archived" while the pull worker spelled it as "not disabled", a disabled
  source kept ingesting and flipped itself back to active (GOV-01). The rule
  reports a `status` compared with "disabled" or "awaiting_first_event" in the
  governance module's production code, outside the liveness file. Anomaly
  rules carry their own status, so files under an anomaly path are left alone.

  @unit
  Scenario: A source status compared with the disabled state is reported
    Given governance process code that checks `source.status !== "disabled"`
    When the ingestion-source-status-literal rule runs over it
    Then it reports statusLiteral and names the liveness rule to call

  @unit
  Scenario: The positive spelling of liveness is reported
    Given governance code that checks status is "active" or "awaiting_first_event"
    When the ingestion-source-status-literal rule runs over it
    Then it reports the "awaiting_first_event" comparison

  @unit
  Scenario: A bare status variable is reported in browser code too
    Given governance browser code that checks `status === "disabled"`
    When the ingestion-source-status-literal rule runs over it
    Then it reports statusLiteral

  @unit
  Scenario: The liveness file, anomaly rules, tests and other modules are left alone
    Given the same comparison in the liveness file, an anomaly rule file, a governance test and another module
    When the ingestion-source-status-literal rule runs over each
    Then it reports nothing

  @unit
  Scenario: A status that is not a source state is left alone
    Given governance code that checks `status === "active"` or `kind === "disabled"`
    When the ingestion-source-status-literal rule runs over it
    Then it reports nothing
