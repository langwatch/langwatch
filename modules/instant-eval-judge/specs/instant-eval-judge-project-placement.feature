Feature: The Instant Evals judge places a project from its owners' tables

  As the platform
  I want the judge to read a project's organization where project and organization keep it
  So that every existing project judges on the first call after a deploy, with no catch-up

  Round 46 E1 (R40): the judge reads project's Project rows and organization's Team rows through
  declared Postgres shares instead of folding lw.project.created into its own copy. The copy's
  table stays until a contract migration retires it; nothing writes or reads it.

  @integration
  Scenario: The judge reads a project's organization through its team
    Given a project stored by project, in a team organization stores under an organization
    And the judge never folded a created fact for it
    When the judge places the project
    Then it knows the team's organization

  @integration
  Scenario: A project its owner does not hold is unknown to the judge
    Given no project with that id in project's table
    When the judge places the project
    Then the project is unknown

  @unit
  Scenario: A project created before the deploy judges on the first call, with no catch-up
    Given a LangWatch cloud install
    And a project created before the judge was deployed, held by its owners
    When a judge call arrives for it
    Then it is classified
    And its spend is charged to that project's organization
