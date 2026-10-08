Feature: Data retention reads where each project sits from project's and organization's rows
  Data retention reads a project's team from project's `Project` table and a team's organisation
  from organization's `Team` table, through Postgres shares the owners declare (R40, round 46 E1).
  It keeps no copy, so a project that existed before a deploy resolves on the first request after
  it, with no fact, fold or replay to wait for (plan rows R02 and DATA-PROJECT-SCOPE).

  @unit
  Scenario: An existing project resolves retention on the first request after deploy
    Given project's table places a project under a team of an organisation, and project recorded no fact for it
    When data retention resolves that project's retention
    Then it resolves through the project, its team and that organisation

  @unit
  Scenario: A moved project resolves under the team its row names now
    Given a project whose row names a team it was moved to
    When data retention resolves that project's retention
    Then the rule set on the new team applies

  @unit
  Scenario: An archived project keeps its place, so its stored data still expires
    Given a project whose row is archived
    When data retention resolves that project's retention
    Then it still resolves under its team and organisation

  @unit
  Scenario: A team is placed in its organisation by its own row
    Given a team of an organisation that holds no project yet
    When data retention asks which organisation the team sits in
    Then the team's row answers, so a team-level rule can be written before its first project

  @unit
  Scenario: Data retention installs no project-scope fold and no replay step
    Given a worker that installs data retention
    When it boots and collects its migration steps
    Then no data retention project-scope pipeline runs
    And "data-retention:replay-project-scope" is not among the steps

  @unit
  Scenario: The memory and Postgres placement readers answer alike
    Given an organisation with a team holding a live and an archived project, and a second team with none
    When each placement reader is asked for those projects, that team and the organisation's projects
    Then both answer the same placements, archived projects included
    And neither knows a project or team that has no row
