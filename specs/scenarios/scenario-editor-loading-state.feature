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

  # The prompt catalog loads on the same screen, but it says nothing about the
  # scenario being edited. The form waits for its own read and nothing else.
  # This is what the customer actually hit: the catalog was slow and the
  # editor sat blank behind it.
  @integration
  Scenario: The editor does not wait for the prompt catalog
    Given the editor is opened on an existing scenario
    When the scenario has been read
    And the prompt catalog has not answered yet
    Then the fields hold the scenario's values

  # Creating a scenario reads nothing, so the editor must never wait. The read
  # is disabled in that case and reports itself as not loading, but the editor
  # gates on there being a scenario to read at all rather than trusting that.
  @integration
  Scenario: A new scenario never waits on a read
    Given the editor is opened to create a scenario
    When no scenario has been read
    Then the fields are offered immediately
    And no placeholder is shown

  # A failed read ends the wait without producing a record. Treated as "loaded",
  # it gives back the same blank form the placeholder exists to prevent, except
  # now the fields are editable and saving them creates a second scenario.
  Rule: A scenario that could not be read is not offered as a form

    @integration
    Scenario: A failed read says so instead of showing empty fields
      Given the editor is opened on an existing scenario
      When the scenario could not be read
      Then the editor says it could not load the scenario
      And no empty form field is offered

    @integration
    Scenario: A failed read offers the read again
      Given the editor is opened on an existing scenario
      When the scenario could not be read
      And the person asks to try again
      Then the scenario is read again

    @integration
    Scenario: A failed read does not offer to save
      Given the editor is opened on an existing scenario
      When the scenario could not be read
      Then the save actions are not offered

    @integration
    Scenario: Editing never creates a second scenario
      Given the editor is opened on an existing scenario
      When the scenario has not been read yet
      And a save is attempted anyway
      Then no scenario is created

    # The read cannot start before the project is known, and a read that has
    # not started does not report itself as loading. Read as "loaded", it gives
    # back the same blank form by a different route.
    @integration
    Scenario: The editor waits for the project too
      Given the editor is opened on an existing scenario
      When the project is not known yet
      Then the editor shows a placeholder in place of the fields
      And no empty form field is offered

  # Once the scenario is on screen the person edits it, and the editor keeps
  # reading it in the background. A background read that fails has a record to
  # show and edits in the fields, so replacing them with an error takes work
  # away that the person did.
  Rule: A failed read only takes over when there is nothing to show

    @integration
    Scenario: A failed background read keeps the scenario on screen
      Given the editor is opened on an existing scenario
      When the scenario has been read
      And a later read of it fails
      Then the fields hold the scenario's values
      And the editor does not say it could not load the scenario
