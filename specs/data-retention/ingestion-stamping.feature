Feature: Retention stamping at ingestion time
  As the ingestion pipeline
  I stamp every ClickHouse record with _retention_days and _size_bytes
  So that ClickHouse TTL can delete expired rows during background merges

  # Retention is always a whole number of weeks (multiple of 7 days) so it
  # aligns with the weekly partition key (toYearWeek).
  #
  # Retention is default-on: a tenant with no override is stamped the platform
  # default (49 days / 7 weeks), never left indefinite. That is distinct from
  # the migration column default (308 days), which only governs rows written
  # before the _retention_days column existed and is never stamped at ingestion.

  Background:
    Given the project has retention policy {"traces": 49, "scenarios": 63, "experiments": 91}

  Scenario: Trace pipeline stamps _retention_days from traces category
    When a span is ingested for this project
    Then the stored_spans record has _retention_days = 49
    And the trace_summaries record has _retention_days = 49
    And the event_log record has _retention_days = 49
    And the evaluation_runs record has _retention_days = 49
    And the stored_metric_records record has _retention_days = 49
    And the dspy_steps record has _retention_days = 49

  Scenario: Scenario pipeline stamps _retention_days from scenarios category
    When a simulation run is recorded for this project
    Then the simulation_runs record has _retention_days = 63
    And the suite_runs record has _retention_days = 63

  Scenario: Experiment pipeline stamps _retention_days from experiments category
    When an experiment run is recorded for this project
    Then the experiment_runs record has _retention_days = 91
    And the experiment_run_items record has _retention_days = 91

  @unit
  Scenario: Event log rows use the workload's retention category
    When simulation and suite run events are recorded for this project
    Then their event_log records have _retention_days = 63
    When an experiment run event is recorded for this project
    Then its event_log record has _retention_days = 91

  @unit
  Scenario: Security events are retained indefinitely
    When identity, MFA, SSO, join-request, SCIM, authorization, or virtual-key lifecycle events are recorded
    Then their event_log records have _retention_days = 0

  @unit
  Scenario: Tenant retention never enrolls durable security projections
    When the ClickHouse retention table registry is built
    Then identity, credential, SSO, SCIM, membership, and authorization projection stores are absent
    And explicit revocation, teardown, erasure, session expiry, and proof expiry remain unchanged

  # Only customer telemetry expires (Alex, 2026-10-09); every other event is kept forever.
  @unit
  Scenario: Customer telemetry event families remain policy-bound
    When trace, log, metric, evaluation, collector-evaluation, Langy-conversation, topic-model, gateway-spend, automation-trigger-match, coding-agent-fact, later-trace milestone, evaluation-lifecycle completion, Instant Eval run, pulled-usage, webhook spend-delivery, or ingestion-pull run and listing events are recorded
    Then their event_log records use the traces retention category

  @unit
  Scenario: Every other event family is retained indefinitely
    When organization, project, user, prompt, workflow, billing, entitlement, governance, annotation, Instant Eval judge spend, aggregate-read audit, first-trace milestone, manual evaluation run, ingestion-pull configuration, or report-schedule configuration events are recorded
    Then their event_log records have _retention_days = 0

  @unit
  Scenario: An aggregate type the policy does not list is retained indefinitely
    When an event of an aggregate type the policy does not list is recorded
    Then its event_log record has _retention_days = 0

  @integration
  Scenario: Every aggregate type the worker registers is classified
    When the worker boots every installed module
    Then each registered pipeline's aggregate type is listed in the event-log retention policy
    And a new telemetry pipeline cannot reach the event log without naming its category

  Scenario: No retention policy defaults to the platform default
    Given the project has no retention policy
    And the organization has no default retention policy
    When a span is ingested for this project
    Then the stored_spans record has _retention_days = 49

  Scenario: Size estimation stamped at ingestion
    When a span with 2KB of attributes is ingested
    Then the stored_spans record has _size_bytes approximately 2048

  Scenario: Changing a policy does not restamp already-ingested data
    Given data was ingested under the platform default of 49 days
    When retention is later configured to 91 days
    Then previously ingested data still has _retention_days = 49
    And only newly ingested data has _retention_days = 91
