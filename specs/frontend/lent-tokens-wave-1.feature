Feature: Lent tokens live in their owner's client, wave 1
  A module lends a component or a drawer by a token declared in its own client
  package. A reader imports the token from that client and renders or opens it,
  without importing the owner's browser package (ARCHITECTURE.md §10.1).

  @unit
  Scenario: Scenario lends its Talk to it panel by its client token
    Given the scenario browser is installed
    When agent's voice editor reads the Talk to it panel token from scenario's client
    Then the wired call panel loads

  @unit
  Scenario: Scenario lends its parameter line by its client token
    Given the scenario browser is installed
    When agent's test panel reads the parameter line token from scenario's client
    Then the lent parameter line loads

  @integration
  Scenario: Agent renders scenario's parameter line through the client token
    Given scenario lends the parameter line token
    When agent's test panel renders the parameter line
    Then scenario's field renders with the agent's declared parameters

  @integration
  Scenario: An uninstalled lender leaves the reader's fallback
    Given no installed module lends the parameter line token
    When agent's test panel renders the parameter line
    Then no field renders and nothing fails

  @integration
  Scenario: The studio renders dataset's editor table through its client token
    Given dataset lends its editor table token
    When the studio edits a draft dataset in its dataset dialog
    Then dataset's editor table renders and its edits reach the workflow

  @integration
  Scenario: The studio opens dataset's upload drawer by its client token
    Given the studio's dataset dialog is open
    When the user uploads a CSV
    Then dataset's upload drawer opens by its drawer token
    And the dataset it creates is bound to the node
