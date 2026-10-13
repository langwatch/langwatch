Feature: Workbench update signals

  A workbench write tells the project's open editor tabs which version it landed at, over presence's
  tenant fabric. The signal names the experiment and version, never the state.

  @unit
  Scenario: A workbench save announces the version it landed at
    Given a workbench save lands on an existing experiment
    When the save completes
    Then one experiment_updated notice carries the experiment, slug, new version, actor and run

  @unit
  Scenario: A refused save announces nothing
    Given a workbench save is refused as stale
    When the save is refused
    Then no experiment_updated notice is published

  @unit
  Scenario: A workbench create announces version one
    Given a workbench save creates a new experiment
    When the create completes
    Then one experiment_updated notice carries version 1 for the new experiment

  @unit
  Scenario: A workflow evaluation refresh announces the bumped version as the api
    Given a workflow's experiment already exists
    When a workflow evaluation refreshes its workbench state
    Then the experiment's counter moves
    And one experiment_updated notice carries the new version with the api as actor

  @unit
  Scenario: A notice rides presence on the notice's own project only
    Given a workbench update notice for a project
    When it is published
    Then presence receives one experiment_updated event for that project and no other
    And the event carries the signal and no workbench state

  @unit
  Scenario: A failed publish is logged and never undoes the save
    Given the presence fabric refuses the publish
    When a workbench update notice is published
    Then a warning is logged
    And the publish resolves
