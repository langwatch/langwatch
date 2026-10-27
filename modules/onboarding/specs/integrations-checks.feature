Feature: The setup checklist reports how far a project has been set up

  `integrationsChecks.getCheckStatus` answers main's onboarding checks. Each
  figure is counted by the module that owns it; onboarding only assembles them.

  @unit
  Scenario: Every step reads as done once its owner holds one
    Given a project whose owners each hold at least one of their records
    When the setup checklist is read
    Then every step figure is 1, the team size is the count of its members
    And the project's own first-message and integrated flags are carried through

  @unit
  Scenario: A fresh project reports every step undone
    Given a project whose owners hold nothing yet
    When the setup checklist is read
    Then every step figure is 0

  @unit
  Scenario: An unreachable simulations store leaves the step undone
    Given the scenario module fails to read the project's scenario sets
    When the setup checklist is read
    Then simulations is 0 and the rest of the answer still arrives

  @unit
  Scenario: A model provider counts through the organization and team scopes
    When the setup checklist is read
    Then model providers are counted across the project, its team and its organization

  @unit
  Scenario: The checklist carries the organization's guided onboarding
    Given an organization in guided onboarding with picked and finished paths
    When the setup checklist is read
    Then it carries the variant, the paths, the current path and the finished paths

  @unit
  Scenario: The setup checklist is gated on project update
    Then `integrationsChecks.getCheckStatus` requires project:update, as main did

  @unit
  Scenario: The checklist answers through the tRPC door with main's shape
    Given a caller who may update the project
    When they call integrationsChecks.getCheckStatus
    Then the answer parses against the declared checklist schema


  @integration
  Scenario: The alert step reads as done from automation's own list
    Given a project
    When the setup checklist renders its alert step
    Then the step reads as done exactly when automation lists an automation for the project
    And onboarding's server answer carries no trigger figure
