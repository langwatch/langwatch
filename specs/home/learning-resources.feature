@unit
Feature: Learning Resources
  As a user
  I want access to learning resources
  So that I can learn how to use the platform effectively

  Background:
    Given I am on the home page

  # Card display
  Scenario: Displays documentation link
    When I view the learning resources section
    Then I should see a "View documentation" link or button

  Scenario: Displays video link
    When I view the learning resources section
    Then I should see a "Watch videos" or "Play video" link or button

  # Link targets
  Scenario: Documentation link points to docs site
    When I view the documentation link
    Then the href should contain "docs.langwatch.ai"

  Scenario: Video link points to YouTube
    When I view the video link
    Then the href should contain "youtube.com/@LangWatch"

  # Tracking
  Scenario: Documentation click is tracked
    When I click on the documentation link
    Then a tracking event should be sent for "documentation_click"

  Scenario: Video click is tracked
    When I click on the video link
    Then a tracking event should be sent for "video_click"

  @visual
  Scenario: Section has descriptive title
    When I view the learning resources section
    Then I should see a section title

  @visual
  Scenario: Card has appropriate styling
    When I view the learning resources section
    Then the card should be visually distinct
