Feature: Retention stamping at ingestion time
  As the ingestion pipeline
  I stamp every ClickHouse record with _retention_days and _size_bytes
  So that ClickHouse TTL can delete expired rows during background merges

  # Retention is always a whole number of weeks (multiple of 7 days) so it
  # aligns with the weekly partition key (toYearWeek).

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

  Scenario: No retention policy defaults to indefinite
    Given the project has no retention policy
    And the organization has no default retention policy
    When a span is ingested for this project
    Then the stored_spans record has _retention_days = 0

  Scenario: Size estimation stamped at ingestion
    When a span with 2KB of attributes is ingested
    Then the stored_spans record has _size_bytes approximately 2048

  Scenario: Existing data without retention policy keeps _retention_days = 0
    Given data was ingested before retention was configured
    When retention is later configured to 49 days
    Then previously ingested data still has _retention_days = 0
    And only newly ingested data has _retention_days = 49
