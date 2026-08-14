Feature: The scenario editor says when it is still reading

  Opening a scenario for editing reads it first. Until the read answers, the
  editor knows nothing about the scenario, so it used to render the complete
  form with every field at its empty default: no name, no situation, no
  criteria.

  That is indistinguishable from a scenario that really is empty. A customer
  who had just asked an agent to write one read it as the agent having done
  nothing, which is the report this came from. The fields did fill in a second
  or two later, but by then the conclusion was already drawn.

  The read is also what decides whether saving updates this scenario or
  creates a new one, so the same window let a save land as a duplicate.

  Background:
    Given a scenario library with at least one scenario

  @integration
  Scenario: An unloaded scenario shows that it is loading
    Given the editor is opened on an existing scenario
    When the scenario has not been read yet
    Then the editor shows a placeholder in place of the fields
    And no empty form field is offered

  # The drawer used to take the loaded record as the proof that it was editing
  # one, so for the whole of the read it titled itself "Create Scenario" over a
  # scenario the person had just clicked.
  @integration
  Scenario: An unloaded scenario is still titled as an edit
    Given the editor is opened on an existing scenario
    When the scenario has not been read yet
    Then the editor is titled as editing, not creating

  @integration
  Scenario: Saving is not offered until the scenario has loaded
    Given the editor is opened on an existing scenario
    When the scenario has not been read yet
    Then the save actions are busy

  @integration
  Scenario: A loaded scenario shows its fields
    Given the editor is opened on an existing scenario
    When the scenario has been read
    Then the placeholder is gone
    And the fields hold the scenario's values
    And the save actions are available

  # Creating a scenario reads nothing, so the editor must never wait. The read
  # is disabled in that case and reports itself as not loading, but the editor
  # gates on there being a scenario to read at all rather than trusting that.
  @integration
  Scenario: A new scenario never waits on a read
    Given the editor is opened to create a scenario
    When no scenario has been read
    Then the fields are offered immediately
    And no placeholder is shown
