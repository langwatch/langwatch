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
    When the credential backfill runs
    Then the latest and published versions are rewritten with references, each token stored once
    And only workflows still holding a literal are updated
    And a node whose secret cannot be stored is left as it was
