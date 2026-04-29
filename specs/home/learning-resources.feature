@unit
Feature: Learning Resources
  As a user
  I want access to learning resources
  So that I can learn how to use the platform effectively

  Background:
    Given I am on the home page

  # Card display
  @unimplemented
  Scenario: Displays documentation link
    When I view the learning resources section
    Then I should see a "View documentation" link or button

  @unimplemented
  Scenario: Displays video link
    When I view the learning resources section
    Then I should see a "Watch videos" or "Play video" link or button

  # Link targets
  @unimplemented
  Scenario: Documentation link points to docs site
    When I view the documentation link
    Then the href should contain "docs.langwatch.ai"

  @unimplemented
  Scenario: Video link points to YouTube
    When I view the video link
    Then the href should contain "youtube.com/@LangWatch"

  # Tracking
  @unimplemented
  Scenario: Documentation click is tracked
    When I click on the documentation link
    Then a tracking event should be sent for "documentation_click"

  @unimplemented
  Scenario: Video click is tracked
    When I click on the video link
    Then a tracking event should be sent for "video_click"

  @visual @unimplemented
  Scenario: Section has descriptive title
    When I view the learning resources section
    Then I should see a section title

  @visual @unimplemented
  Scenario: Card has appropriate styling
    When I view the learning resources section
    Then the card should be visually distinct
