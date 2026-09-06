@unit
Feature: Learning Resources
  As a user
  I want pointers to documentation and tutorials from the home page
  So that I can learn the platform when I need to — without the pointers
  competing with my own project's data

  The section is a quiet footer row of text links under a hairline rule,
  not banner cards: the home page belongs to the returning user's live
  signal, and learning material is reference, not a destination.

  Background:
    Given I am on the home page

  Scenario: Displays documentation link
    When I view the resources footer
    Then I should see a "View documentation" link
    And its href should contain "docs.langwatch.ai"

  Scenario: Displays video link
    When I view the resources footer
    Then I should see a "Watch videos" link
    And its href should contain "youtube.com/@LangWatch"

  Scenario: Displays the demo ask
    When I view the resources footer
    Then I should see a "Request a demo" link
    And its href should contain "langwatch.ai/get-a-demo"

  @visual
  Scenario: The footer stays quiet
    When I view the resources footer
    Then it renders as a single row of text links under a hairline rule
    And it contains no cards and no animated backgrounds
