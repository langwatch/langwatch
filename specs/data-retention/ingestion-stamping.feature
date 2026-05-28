Feature: Retention stamping at ingestion time
  As the ingestion pipeline
  I stamp every ClickHouse record with _retention_days and _size_bytes
  So that ClickHouse TTL can delete expired rows during background merges

  Background:
    Given the project has retention policy {"traces": 30, "scenarios": 60, "experiments": 90}

  Scenario: Trace pipeline stamps _retention_days from traces category
    When a span is ingested for this project
    Then the stored_spans record has _retention_days = 30
    And the trace_summaries record has _retention_days = 30
    And the event_log record has _retention_days = 30
    And the evaluation_runs record has _retention_days = 30
    And the stored_log_records record has _retention_days = 30
    And the stored_metric_records record has _retention_days = 30
    And the dspy_steps record has _retention_days = 30

  Scenario: Scenario pipeline stamps _retention_days from scenarios category
    When a simulation run is recorded for this project
    Then the simulation_runs record has _retention_days = 60
    And the suite_runs record has _retention_days = 60

  Scenario: Experiment pipeline stamps _retention_days from experiments category
    When an experiment run is recorded for this project
    Then the experiment_runs record has _retention_days = 90
    And the experiment_run_items record has _retention_days = 90

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
    When retention is later configured to 30 days
    Then previously ingested data still has _retention_days = 0
    And only newly ingested data has _retention_days = 30
