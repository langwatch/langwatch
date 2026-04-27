Feature: Python SDK async-native experiment parallelism
  As a Python SDK user running experiments over async agents or loop-bound clients
  I want a first-class async execution mode for experiment.loop / experiment.submit
  So that singletons (gRPC channels, Firestore, ADK runners, connection pools) keep working and every item gets an isolated trace

  Background:
    Given a LangWatch client initialized with a valid API key
    And an experiment instance created via langwatch.experiment(slug="<slug>")

  # --- Core isolation: each item gets its own trace ---

  @unit
  Scenario: each concurrent item runs under its own OTel trace
    Given an async loop iterates a dataset of 10 items with concurrency 4
    And each item is processed by an async callable submitted via asubmit
    When the loop completes
    Then 10 distinct trace IDs are emitted
    And no span is attributed to more than one trace

  @unit
  Scenario: iteration context does not leak between concurrent items
    Given an async loop iterates a dataset with concurrency 4
    When two items read the iteration index concurrently
    Then each item observes its own index
    And neither item sees the other's index

  # --- Loop-bound resource survival (the customer's regression) ---

  @unit
  Scenario: a loop-bound resource created outside the loop is reused by all items
    Given a single async resource is created on the caller's event loop
    And the loop-bound resource would raise "attached to a different loop" if touched from a different loop
    When an async loop submits 10 items that each await the shared resource concurrently
    Then every item completes successfully
    And no "attached to a different loop" error is raised

  # --- Mixed sync + async callables ---

  @unit
  Scenario: a sync callable submitted to an async loop does not block concurrent items
    Given an async loop running with concurrency 2
    And one item submits a sync callable that sleeps
    And a sibling item submits an async callable that also sleeps
    When both items run concurrently
    Then the sibling async item makes progress while the sync callable is still sleeping
    And both items complete

  # --- Concurrency bound ---

  @unit
  Scenario: concurrency limit caps in-flight items
    Given an async loop with concurrency 3
    When 10 items are submitted
    Then no more than 3 items execute simultaneously at any point in time

  # --- Per-item failure isolation ---

  @unit
  Scenario: one failing item does not abort siblings
    Given an async loop iterates 5 items
    When the third item raises an exception in its submitted callable
    Then the remaining four items complete successfully
    And the failed item is recorded with its error
    And the run is reported as finished

  # --- Backend recording ---

  @integration
  Scenario: every item reports a trace_id in the batch payload
    Given an async loop has completed 10 items
    When the batch log_results requests are inspected
    Then each dataset entry carries a non-empty trace_id
    And the collected trace_ids are all distinct

  @integration
  Scenario: final batch reports progress and finished_at
    Given an async loop has completed all items
    When the final batch request is inspected
    Then the payload includes a finished_at timestamp
    And progress equals total

  # --- Google ADK end-to-end ---

  @e2e
  Scenario: ADK runner singleton is reused across concurrent async items
    Given the Google ADK instrumentor is configured
    And an InMemoryRunner is created once on the caller's event loop
    When an async loop submits 10 items that each call runner.run_async concurrently
    Then no "attached to a different loop" error is raised
    And every item receives a final response from the agent

  @e2e
  Scenario: ADK traces land in ClickHouse, isolated per item
    Given an async loop has completed 10 items backed by an ADK agent
    When the experiment run is queried from ClickHouse
    Then trace_summaries contains 10 distinct trace IDs for this run
    And experiment_run_items links each item to exactly one of those trace IDs
    And stored_spans for each trace contain only spans that belong to that trace

  @e2e
  Scenario: costs and token counts are collected per item
    Given an async loop has completed items that produced LLM cost via ADK
    When trace_summaries is queried for the run
    Then each trace has a non-zero TotalCost
    And each trace has non-zero TotalPromptTokenCount and TotalCompletionTokenCount
    And experiment_run_items exposes the per-item TargetCost
