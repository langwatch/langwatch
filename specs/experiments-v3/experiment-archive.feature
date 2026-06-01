@integration
Feature: Experiments are archived, not hard-deleted
  As a user clicking "Delete" on an experiment in the evaluations page
  I want the experiment to disappear from my list immediately
  But I also want the platform to NOT churn the ClickHouse cold tier
  Because every hard delete forces a lightweight-delete mask onto every
  matching part on S3 and triggers a multi-day merge tail — a recurring
  ~$200/mo S3 cost on a 3-45-deletes/day workload, growing with usage.

  # Background: every other major entity in the schema (Workflow, Monitor,
  # Dataset, Evaluator, Agent, Optimization, Project, Team) uses archivedAt.
  # Experiment is the inconsistent outlier; this feature aligns it with the
  # rest of the codebase. Once project-wide retention TTL ships, archived
  # rows age out of ClickHouse naturally via the TTL clause; until then they
  # sit in cold storage without imposing per-click S3 traffic.

  # ============================================================================
  # Soft-archive semantics
  # ============================================================================

  Scenario: Archiving an experiment sets archivedAt and preserves the row
    Given a project "p1" with an experiment "exp1" with archivedAt = null
    And the experiment has 100 runs in ClickHouse `experiment_runs`
    When I call the `experiments.deleteExperiment` tRPC procedure with experimentId "exp1"
    Then the Experiment row for "exp1" still exists in Postgres
    And the Experiment row's archivedAt is set to a recent timestamp (within last 5 seconds)
    And the ClickHouse `experiment_runs` rows for that experiment are untouched
    And the ClickHouse `experiment_run_items` rows for that experiment are untouched
    And the ClickHouse `dspy_steps` rows for that experiment are untouched
    And the Elasticsearch `batch_evaluation` documents for that experiment are untouched

  Scenario: Archiving cascades to the associated workflow and hard-deletes the monitor
    Given a project "p1" with an experiment "exp1" linked to workflow "wf1" and monitor "mon1"
    And workflow "wf1" has archivedAt = null
    When I call `experiments.deleteExperiment` for "exp1"
    Then workflow "wf1" archivedAt is set to a recent timestamp
    And the monitor row "mon1" is removed from Postgres
    And workflowVersion rows under "wf1" still exist in Postgres
    # The Monitor model has no archivedAt column and is a small relational row
    # with no ClickHouse / S3 footprint, so hard-delete remains correct for it.
    # The cost-driving path was the ClickHouse mass-delete on experiment_runs
    # / experiment_run_items / dspy_steps — that is what this feature removes.

  Scenario: Archiving without a workflow or monitor still succeeds
    Given an experiment "exp_no_wf" with workflowId = null and no monitor
    When I call `experiments.deleteExperiment` for "exp_no_wf"
    Then the experiment is archived
    And no Prisma error fires for the missing workflow or monitor

  # ============================================================================
  # List / get query semantics
  # ============================================================================

  Scenario: Archived experiments are hidden from the standard list query
    Given a project "p1" with experiments "live1", "live2" (archivedAt=null) and "old1", "old2" (archivedAt set)
    When the UI calls `experiments.getAllExperiments`
    Then the response contains "live1" and "live2"
    And the response does NOT contain "old1" or "old2"

  Scenario: A single getExperiment by id returns archived experiments as not-found
    Given an experiment "exp_archived" with archivedAt set
    When the UI calls `experiments.getExperimentBySlugOrId` with id "exp_archived"
    Then the procedure returns NOT_FOUND (404)
    # We don't want stale UI state pointing at an archived experiment.

  Scenario: A second click on the same already-archived experiment is a no-op
    Given an experiment "exp1" with archivedAt already set to 1 hour ago
    When I call `experiments.deleteExperiment` for "exp1"
    Then the call returns success
    And the archivedAt timestamp is NOT overwritten
    # Idempotency: avoid spurious DB writes on duplicate clicks.

  # ============================================================================
  # No ClickHouse / Elasticsearch / DSpy delete calls
  # ============================================================================

  Scenario: The delete-experiment code path does NOT contact ClickHouse
    Given the test runner has wrapped the ClickHouse client with an assertion
      that fails the test if any DELETE / UPDATE / command call is issued
    When I call `experiments.deleteExperiment` for any experiment
    Then no ClickHouse mutation is issued
    And no S3 PUT / DELETE is triggered by the request

  Scenario: The delete-experiment code path does NOT contact Elasticsearch
    Given the test runner has wrapped the Elasticsearch client with an assertion
      that fails the test if any deleteByQuery call is issued against the
      batch_evaluation index
    When I call `experiments.deleteExperiment` for any experiment
    Then no deleteByQuery call is issued

  Scenario: The delete-experiment code path does NOT call the DSpy step cleanup
    Given the test runner has wrapped getApp().dspySteps.steps.deleteByExperiment
      with an assertion that fails on invocation
    When I call `experiments.deleteExperiment` for any experiment
    Then deleteByExperiment is never called

  # ============================================================================
  # Permission + tenancy
  # ============================================================================

  Scenario: A user without workflows:delete cannot archive experiments
    Given a user "u_viewer" who does NOT have the "workflows:delete" permission on project "p1"
    When "u_viewer" calls `experiments.deleteExperiment` for an experiment in "p1"
    Then the call returns FORBIDDEN

  Scenario: An experiment from another project cannot be archived
    Given two projects "p1" and "p2"
    And experiment "exp_in_p2" belongs to project "p2"
    When a user authorized for project "p1" calls `experiments.deleteExperiment` with experimentId "exp_in_p2" and projectId "p1"
    Then the call returns NOT_FOUND
    And the archivedAt on "exp_in_p2" remains null
