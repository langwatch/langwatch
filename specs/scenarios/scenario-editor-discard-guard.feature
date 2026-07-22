Feature: The scenario editor asks before throwing work away
  As someone drafting a scenario
  I want to be asked before a close discards what I have written
  So that a stray Escape or a mis-aimed click does not cost me the draft

  # A new scenario exists only in the form until the first save — there is no
  # record to come back to and no draft to recover. The AI-drafted case is the
  # same loss for a different reason: the user did not type it, but a model
  # call produced it and closing spends that call for nothing.

  Background:
    Given I am logged into project "my-project"
    And the scenario editor is open

  # ============================================================================
  # When to ask
  # ============================================================================

  @integration
  Scenario: An untouched new scenario closes without a question
    Given I have opened a blank new scenario and typed nothing
    When I close the editor
    Then the editor closes immediately
    And I am not asked to confirm

  @integration
  Scenario: A scenario I have typed into asks before closing
    Given I have typed a name into a new scenario
    When I close the editor
    Then the editor stays open
    And I am asked whether to discard the scenario

  @integration
  Scenario: An AI-drafted scenario I have not edited still asks
    # The draft arrives as the form's defaults, so the form is not "dirty" —
    # but closing loses a generated scenario just the same.
    Given the editor was opened with an AI-drafted name and situation
    And I have not changed anything
    When I close the editor
    Then I am asked whether to discard the scenario

  @integration
  Scenario: An existing scenario I have edited asks before closing
    Given I am editing the saved scenario "Refund Flow"
    And I have changed its situation
    When I close the editor
    Then I am asked whether to discard my changes

  @integration
  Scenario: An existing scenario I have only read closes without a question
    Given I am editing the saved scenario "Refund Flow"
    And I have changed nothing
    When I close the editor
    Then the editor closes immediately

  # ============================================================================
  # Answering the question
  # ============================================================================

  @integration
  Scenario: Keeping the work returns me to the editor with it intact
    Given I have typed a name into a new scenario
    And I have been asked whether to discard it
    When I choose to keep editing
    Then the question closes
    And the editor is still open
    And the name I typed is still there

  @integration
  Scenario: Discarding closes the editor
    Given I have typed a name into a new scenario
    And I have been asked whether to discard it
    When I choose to discard
    Then the editor closes

  @integration
  Scenario: Discarding never saves the scenario
    Given I have typed a name into a new scenario
    And I have been asked whether to discard it
    When I choose to discard
    Then no scenario is created

  # ============================================================================
  # Which closes are guarded
  # ============================================================================

  @integration
  Scenario: Cancel is guarded like every other close
    Given I have typed a name into a new scenario
    When I click "Cancel"
    Then I am asked whether to discard the scenario

  @integration
  Scenario: A successful save closes without asking
    # Saving is what the question exists to protect; having saved, there is
    # nothing left to lose.
    Given I have typed a name into a new scenario
    When I save it and the save succeeds
    Then the editor closes
    And I am not asked to confirm
