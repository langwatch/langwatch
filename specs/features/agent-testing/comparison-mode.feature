Feature: Comparison mode
  As a person who wants to know which agent, or which model, does better
  I want one run that goes against several targets
  So that the same scenarios are judged on each and the numbers sit next to each other

  Background: a target is an agent and its parameters.
    A comparison run goes against a list of targets. A target is an agent
    together with the parameter overrides that run of the agent gets, so the
    same agent may appear twice with different parameters: one connection, two
    models.

    In the run dialog, "Compare agents" replaces the "Agent to be tested" and
    the "Parameters" sections with one section, "Compare agents". The section
    holds one row per target: a colour dot, the agent, a parameters line in the
    "name=value, name=value" grammar, and an x. The colour of a row is its
    position, and the same colour marks that target on the run detail.

    Secret parameters stay run-level and shared across the targets, so a scope
    that declares one shows a single "Secret parameters" block under the rows.

  # --- The rows ---

  @integration
  Scenario: Compare agents replaces the agent and the parameter sections
    Given the run dialog with "dev-agent" chosen and the parameter line "locale=de"
    When "Compare agents" is chosen
    Then the "Agent to be tested" section and the "Parameters" section are gone
    And the "Add parameters" chip is not offered
    And one "Compare agents" section holds two rows
    And each row carries a colour dot in the colour of its position

  @integration
  Scenario: The first row is the agent that was chosen with its parameter line
    Given the run dialog with "dev-agent" chosen and the parameter line "locale=de"
    When "Compare agents" is chosen
    Then the first row holds "dev-agent" and "locale=de"

  @integration
  Scenario: The second row defaults to the next agent
    Given a project with "dev-agent" and "prod-agent", and "dev-agent" chosen
    When "Compare agents" is chosen
    Then the second row holds "prod-agent" with an empty parameter line

  @integration
  Scenario: The second row defaults to the same agent when there is no other
    Given a project with one agent, "dev-agent"
    When "Compare agents" is chosen
    Then the second row holds "dev-agent" with an empty parameter line

  @integration
  Scenario: A row is added with the first agent and an empty line, up to four
    Given the run dialog in compare mode with two rows
    When "Add a target to compare" is chosen
    Then a third row holds the agent of the first row with an empty parameter line
    And the control is gone once there are four rows

  @integration
  Scenario: The hint under the rows says the same agent twice works
    Given the run dialog in compare mode
    Then under the rows it reads "The same agent twice with different parameters works: one connection, two models."

  @integration
  Scenario: Removing a row down to one leaves compare mode with that row as the agent
    Given the run dialog in compare mode with "dev-agent" and "prod-agent"
    When the row of "dev-agent" is removed
    Then the "Agent to be tested" section is back with "prod-agent" chosen

  @integration
  Scenario: Removing the section puts the first row back
    Given the run dialog in compare mode where the first row holds "dev-agent" and "locale=de"
    When "Remove the comparison" is chosen
    Then "dev-agent" is the agent to be tested
    And the "Parameters" section holds "locale=de"

  @integration
  Scenario: Two rows with the same agent and the same parameters are refused
    Given the run dialog in compare mode with "dev-agent" twice, both with "model=gpt-5-mini"
    Then it reads "Two targets are the same agent with the same parameters."
    And Run is off

  @integration
  Scenario: The secret parameters of the scope are one shared block
    Given a scope that declares a secret parameter
    When "Compare agents" is chosen
    Then one "Secret parameters" block with that row sits under the rows
    And the run waits for its value

  # --- What the run carries ---

  @integration
  Scenario: Each target carries its own parameters
    Given the run dialog in compare mode with "dev-agent" on "model=gpt-5" and "dev-agent" on "model=gpt-5-mini"
    When Run is chosen
    Then the run carries two targets, each with its own parameters
    And the run carries no run-level parameters

  @integration
  Scenario: A stored comparison comes back with every target and its parameters
    Given a stored configuration with three targets, each with its own parameters
    When it is picked from the list
    Then the section holds three rows
    And each row holds the parameters of its target

  # --- The name and the footer ---

  @unit
  Scenario: A target of a comparison is named after its agent
    Given a comparison of "dev-agent" and "prod-agent"
    Then the run name reads "<scope> dev-agent vs prod-agent"

  @unit
  Scenario: The same agent twice is named with its parameters
    Given a comparison of "dev-agent" on "model=gpt-5" and "dev-agent" on "model=gpt-5-mini"
    Then the run name reads "<scope> dev-agent · model=gpt-5 vs dev-agent · model=gpt-5-mini"

  @unit
  Scenario: Targets are sorted by agent and then by parameters
    Given a comparison picked as "prod-agent", then "dev-agent" on "model=b", then "dev-agent" on "model=a"
    Then the targets read "dev-agent · model=a", "dev-agent · model=b", "prod-agent"

  @integration
  Scenario: The footer counts the targets
    Given the run dialog in compare mode with two targets over three scenarios
    Then the Run button reads "Run 3 scenarios × 2 targets"

  # The scenarios of the run detail on a comparison batch (the matrix table,
  # the per-target summaries, the charts, the grid legend, the sidebar line
  # and the targets row of the run settings) are added with that view.
