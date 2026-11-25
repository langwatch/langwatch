Feature: The retired onboarding project address

  `/onboarding/:team/project` no longer has a screen. A project is created from the
  organization's create-project drawer.

  @integration
  Scenario: The old onboarding project page sends you home
    Given I have a saved link to the onboarding project page of a team
    When I open the saved link
    Then I land on the home page
