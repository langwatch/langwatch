Feature: Data retention folds where each project sits from project's facts
  Data retention keeps its own copy of each project's organization and team, folded from
  project's lifecycle facts (Alex, 2026-10-06, Q151 Q1), so resolving a project's retention
  asks project nothing. Existing projects arrive by a projection replay at deploy.

  @unit
  Scenario: A moved project sits under its new team, and a late older fact is inert
    Given project recorded a project created in one team and then moved to another
    When data retention folds those facts, and then receives them again out of order
    Then the project sits under the team it was moved to
    And the repeated facts change nothing

  @unit
  Scenario: A project whose facts name no team yet folds its organization only
    Given project recorded the project's creation before creation facts named a team
    When data retention folds that fact
    Then it holds the project's organization and no team
    And the project's department fact later names the team

  @unit
  Scenario: An archived project keeps its place, so its stored data still expires
    Given project recorded a project created in a team and then archived
    When data retention folds those facts
    Then it records when the project was archived and keeps its team and organization

  @unit
  Scenario: The worker collects retention's project scope replay step and it fills an empty fold once
    Given a worker installs data retention over an empty project fold
    And project's lifecycle log holds a project created in one team and moved to another
    When the worker collects its migration steps
    Then it collects "data-retention:replay-project-scope" as a background data step
    And before it runs the project is refused as not found
    And running it lets the project resolve under the rule set on its new team
    And a second run from the first run's cursor replays nothing
