Feature: Guided onboarding events reach the deployment's product analytics

  @unit
  Scenario: A failed guided turn reads the organization's guided onboarding by project
    Given a project whose organization is in guided onboarding
    When a worker-side reaction asks onboarding for the guided onboarding behind that project
    Then it gets the organization, its variant and its state, with no caller to authorize
    And a project that is gone is refused as project_not_found
