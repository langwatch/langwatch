Feature: Langy mirror settings
  A staff investigation asks which project this deployment mirrors Langy's own traces to. Langy
  answers the project id it was configured with, never the mirror's key (ADR-202).

  @unit
  Scenario: The mirror project id is read as configured, and as unset when blank
    Given a deployment whose LANGY_MIRROR_PROJECT_ID is "project_mirror"
    When the mirror settings are read
    Then the project id is "project_mirror"
    And a deployment with it unset or blank reads no project id
