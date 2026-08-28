@integration
Feature: A batch of simulation runs reports when it is complete
  As a consumer that schedules a batch of simulation runs over the REST API
  I want the batch to report a settled count and a completion flag
  So that a CI job knows when every run of the batch is finished

  # A run that waits in the queue is not finished, so a batch that holds one is
  # not complete and carries no completion time.

  Scenario: A batch with queued runs is not complete
    Given a batch holds one finished run and one queued run
    When the batch aggregate is read
    Then the running count is one and the settled count is one
    And the batch reports itself as not complete

  Scenario: A batch is complete when every run is terminal
    Given a batch holds only runs in a terminal status
    When the batch aggregate is read
    Then the settled count equals the total count

  Scenario: allCompletedAt stays null until the last run settles
    Given a batch holds one finished run and one queued run
    When the batch aggregate is read
    Then allCompletedAt is null, and it carries a timestamp once every run is terminal

  # A single batch is a resource of its own, so a caller that holds a batch run
  # id polls it directly instead of paging the scenario set history.
  Scenario: A batch summary is addressable by its batch run id
    Given a batch exists in the project
    When GET /api/simulation-runs/batches/{batchRunId} is requested
    Then the response carries the batch counts and an isComplete flag

  Scenario: An unknown batch run id answers 404
    Given no batch exists for the requested id
    When GET /api/simulation-runs/batches/{batchRunId} is requested
    Then the response status is 404
