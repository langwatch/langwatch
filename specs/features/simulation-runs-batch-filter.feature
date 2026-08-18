@integration
Feature: Simulation runs list filters by batch id alone
  As a consumer polling a batch of simulation runs over the REST API
  I want GET /api/simulation-runs?batchRunId= to return only that batch
  So that progress polling sees the batch it scheduled, not the whole project

  # The route used to apply the batchRunId filter only when scenarioSetId was
  # also present. The CLI's --wait sends batchRunId alone, so the server
  # answered with every run in the project, and stale in-progress runs from
  # old batches held the wait open until its timeout.

  Scenario: A batch id alone filters the list
    Given runs exist in two different batches
    When the list is requested with only a batchRunId
    Then the response contains the runs of that batch and no others

  Scenario: A batch id with a scenario set id keeps working
    Given runs exist in a batch that belongs to a scenario set
    When the list is requested with both batchRunId and scenarioSetId
    Then the response contains the runs of that batch

  # An empty scenario set id is a value, not an absent filter: it selects the
  # default set, which holds rows written both before and after the set id
  # got its "default" name.
  Scenario: An empty scenario set id still selects the default set
    Given a batch holds one run in the default set and one in a named set
    When the runs are read with the batch id and an empty scenario set id
    Then only the default set run is returned
