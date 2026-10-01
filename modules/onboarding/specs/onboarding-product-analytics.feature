Feature: Guided onboarding events reach the deployment's product analytics

  The PostHog target is ops' deployment fact. Onboarding asks ops for it on
  the first event it sends, never while the process is constructing.

  @unit
  Scenario: A deployment without a product-analytics target sends nothing
    Given ops names no product-analytics target
    When a guided onboarding event is tracked
    Then no PostHog client is built and nothing is sent

  @unit
  Scenario: The target is read on the first event, not at construction
    Given the PostHog channel is constructed
    Then ops has not been asked for the target
    When two guided onboarding events are tracked
    Then ops has been asked once

  @unit
  Scenario: A failed guided turn reads the organization's guided onboarding by project
    Given a project whose organization is in guided onboarding
    When a worker-side reaction asks onboarding for the guided onboarding behind that project
    Then it gets the organization, its variant and its state, with no caller to authorize
    And a project that is gone is refused as project_not_found
