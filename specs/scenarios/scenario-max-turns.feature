Feature: Per-scenario maximum conversation turns
  As a user running agent scenario simulations
  I want to cap how many conversation turns a scenario can take
  So that a simulation stops at a bound I chose instead of always
  running up to the platform default

  # Background
  # ----------
  # A scenario run is a conversation between the user-simulator and the
  # agent under test, refereed by the judge. The scenario engine stops the
  # conversation after a maximum number of turns; on the last turn it
  # forces the judge to give a verdict, and a run that reaches the cap
  # without a conclusion fails.
  #
  # The cap is optional and lives on the scenario itself. A scenario with
  # no cap runs with the engine default of 10 turns. There is no run-plan
  # (suite) override yet; that is a follow-up.

  Background:
    Given I am logged in
    And I have access to a project with an enabled model provider

  @unit
  Scenario: A scenario's turn cap is carried into the run
    Given a scenario with a maximum turns value configured
    When the run data is prefetched
    Then the serialized run configuration carries that turn cap

  @unit
  Scenario: A scenario without a turn cap runs with the engine default
    Given a scenario with no maximum turns value configured
    When the run data is prefetched
    Then the serialized run configuration carries no turn cap
    And the run uses the engine default of 10 turns

  @unit
  Scenario: A job queued before the turn cap existed still runs
    Given a job payload serialized before the turn cap was introduced
    When the payload is parsed at the execution boundary
    Then it is accepted
    And the run uses the engine default of 10 turns

  @integration
  Scenario: The turn cap persists on scenario create and update
    Given a scenario
    When I update the scenario with a maximum turns value
    Then the stored scenario carries that value
    And clearing the value stores no cap again

  @integration
  Scenario: The scenario form lets me set the maximum turns
    Given I am editing a scenario
    When I fill in the "Maximum turns" field
    Then saving the scenario carries the value I entered
    And leaving the field empty saves the scenario with no cap

  @integration
  Scenario: The scenario form rejects an out-of-bounds maximum turns
    Given I am editing a scenario
    When I enter a maximum turns value below 1 or above the allowed maximum
    Then the form shows a validation error
    And the scenario is not saved

  @e2e
  Scenario: A turn cap set in the scenario editor survives saving and reopening
    Given I am creating a scenario in the editor
    When I set the maximum turns to 2 and save
    And I reopen the scenario
    Then the maximum turns field shows 2
    When I clear the maximum turns and save
    And I reopen the scenario
    Then the maximum turns field is empty, meaning the default applies
