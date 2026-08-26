Feature: Experiment service boundary

  Scenario: Required reads throw on absence
    Given no active experiment exists for the project and id
    When the Experiment service reads it
    Then ExperimentNotFoundError is thrown

  Scenario: Slugs remain unique inside a project
    Given an active experiment already uses a slug
    When another experiment is saved with that requested slug
    Then the service allocates the next numeric slug

  Scenario: Archived experiments cannot be resurrected
    Given an experiment is archived
    When a stale client saves the same id
    Then ExperimentNotFoundError is thrown

  Scenario: Archive does not cross persistence boundaries
    Given an experiment links a workflow and monitor
    When the Experiment service archives it
    Then only Experiment persistence is changed
    And the transport composes WorkflowService and MonitorService cleanup

  Scenario: DSPy steps use the Experiment service
    Given a DSPy optimiser reports a step for an experiment run
    When the step is written and read
    Then the Experiment service validates the Zod 4 value
    And uses its private ClickHouse repository

  Scenario: Batch-result presentation remains controlled and portable
    Given app transport has loaded experiment run values
    When it renders batch results
    Then Experiment web preserves controlled result tables, comparisons, and CSV
    And the app keeps routing, polling, feature gates, drawers, and named rendering actions
