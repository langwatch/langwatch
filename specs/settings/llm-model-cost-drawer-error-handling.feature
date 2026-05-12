Feature: LLM model cost drawer save errors
  As a project member editing model pricing
  I want save failures to show a single clear error surface
  So that restriction or limit messages are not stacked with a generic toast

  @regression @integration
  Scenario: LLM model cost drawer skips the generic error toast after a primary error UI is shown
    Given I submit the LLM model cost drawer
    And the save request fails after another part of the app already showed the primary error UI
    When the drawer handles the save error
    Then I do not see a generic error toast

  @integration
  Scenario: LLM model cost drawer shows the generic error toast when no primary error UI is shown
    Given I submit the LLM model cost drawer
    And the save request fails before any other part of the app shows a primary error UI
    When the drawer handles the save error
    Then I see a generic error toast with the save error message
