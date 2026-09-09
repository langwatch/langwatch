@agent
Feature: Connected agent credential project discovery
  Missing-project refusals suggest only projects where the credential may connect an agent.

  @unit
  Scenario: Project discovery excludes projects outside the key bindings
    Given a valid API key with team-scoped access to only some organization projects
    When the key connects without a project identifier
    Then the project_required refusal lists only accessible project identifiers and names

  @unit
  Scenario: Project discovery applies the key owner's effective permission
    Given a valid team-scoped API key whose owner lacks scenarios manage for the team's projects
    When the key connects without a project identifier
    Then the project_required refusal lists no projects

  @unit
  Scenario: Unsupported credentials cannot discover projects
    Given an ingestion key or a Langy session key
    When the key connects without a project identifier
    Then the connection is refused with key_type_not_allowed
    And no organization projects are enumerated
