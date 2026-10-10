@workflow
Feature: HTTP node credentials
  A third party's token typed into an HTTP node is a project secret, not graph data.

  @unit
  Scenario: A token typed into an HTTP node is stored as a project secret and never read back
    Given a workflow with an HTTP node holding a token typed inline
    When the workflow is saved
    Then the token becomes a project secret attributed to the author and the node keeps its reference
    And the saved version is the graph the secret store answered
    And no read of the graph or its history answers the token

  @unit
  Scenario: Credentials typed inline before this change are moved to project secrets
    Given saved workflows whose HTTP nodes still hold literal credentials
    When the workflow credential upgrade step runs, once or more
    Then the latest and published versions are rewritten with references, each token stored once
    And only workflows still holding a literal are updated
    And a dry run stores nothing, saves no progress and reports how many versions it would move

  @unit
  Scenario: A workflow credential that cannot be moved holds the workflow credential step
    Given a workflow whose HTTP node credential cannot be stored as a project secret
    When the workflow credential upgrade step runs
    Then that node is left as it was and every other version is moved
    And the step fails saying how many versions were held, with its progress kept before that workflow's project

  @unit
  Scenario: A workflow version saved while its credentials are being moved keeps the newer save
    Given a workflow version saved again after the workflow credential step read it
    When the step writes the version
    Then the newer save is kept, and the version counts as moved only once a re-read holds no literal

  @unit
  Scenario: The workflow credential step resumes after the last project it finished
    Given the step saved its progress after a project
    When it runs again from that progress
    Then it starts with the next project
