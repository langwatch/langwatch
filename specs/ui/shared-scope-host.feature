Feature: One shared scope host on every route
  Every feature's `useOrganizationTeamProject` reads one scope port that the
  application publishes from its session, so a component one feature lends to
  another (a trace hover card inside a scenario run) finds the same project on
  every route instead of demanding a host only its own routes mount.

  Background:
    Given the browser application mounts the feature shell around every routed page

  @unit
  Scenario: The application session publishes the scope every feature reads
    Given the session has resolved a project, an organization and the caller's grants
    When a screen from any feature reads the shared organization, team and project hook
    Then it sees that project and organization
    And a permission the session granted reads as held

  @unit
  Scenario: A session with no resolved scope leaves the shared hook unresolved rather than throwing
    Given the composition installed a session that publishes no scope
    When a screen reads the shared organization, team and project hook
    Then the reading is unresolved with no project
    And every permission reads as not held
