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
    And the stored_log_records record has _retention_days = 49
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
