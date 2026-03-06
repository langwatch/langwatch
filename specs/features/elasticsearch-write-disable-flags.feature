Feature: Elasticsearch write disable flags
  As a platform operator migrating customers from Elasticsearch to ClickHouse,
  I want to disable Elasticsearch writes per project for traces, evaluations, and simulations,
  so that fully-migrated customers stop putting pressure on Elasticsearch.

  Background:
    Given a project with ClickHouse read and event sourcing write flags enabled
    And the project has the corresponding ES write disable flag enabled

  @unit
  Scenario: Trace ingestion skips Elasticsearch when disabled
    When a trace is ingested for the project
    Then the trace is written to ClickHouse via event sourcing
    And the trace is not indexed into Elasticsearch

  @unit
  Scenario: Trace ingestion still writes to Elasticsearch when flag is off
    Given a project without the ES write disable flag for traces
    When a trace is ingested for the project
    Then the trace is indexed into Elasticsearch as usual

  @unit
  Scenario: Evaluation results skip Elasticsearch sync when disabled
    When an evaluation run completes for the project
    Then the results are written to ClickHouse via event sourcing
    And the results are not synced to the Elasticsearch batch evaluations index

  @unit
  Scenario: Evaluation results still sync to Elasticsearch when flag is off
    Given a project without the ES write disable flag for evaluations
    When an evaluation run completes for the project
    Then the results are synced to Elasticsearch as usual

  @unit
  Scenario: Simulation events skip Elasticsearch when disabled
    When a simulation event is recorded for the project
    Then the event is written to ClickHouse via event sourcing
    And the event is not written to the Elasticsearch scenario events index

  @unit
  Scenario: Simulation events still write to Elasticsearch when flag is off
    Given a project without the ES write disable flag for simulations
    When a simulation event is recorded for the project
    Then the event is written to Elasticsearch as usual

  @unit
  Scenario: New flags default to false
    When a new project is created
    Then all three ES write disable flags are false by default

  @integration
  Scenario: Database migration adds the three new columns
    When the migration runs
    Then the Project table has a "disableElasticSearchTraceWriting" boolean column defaulting to false
    And the Project table has a "disableElasticSearchEvaluationWriting" boolean column defaulting to false
    And the Project table has a "disableElasticSearchSimulationWriting" boolean column defaulting to false
