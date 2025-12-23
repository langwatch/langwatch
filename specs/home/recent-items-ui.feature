@unit
Feature: Recent Items UI
  As a user
  I want to see my recently accessed items on the home page
  So that I can quickly navigate back to what I was working on

  Background:
    Given I am on the home page

  # Loading state
  @visual
  Scenario: Displays loading skeleton while fetching
    Given the recent items API is loading
    When I view the recent items section
    Then I should see skeleton loading cards

  # Empty state
  Scenario: Displays empty state when no recent items
    Given the recent items API returns an empty array
    When I view the recent items section
    Then I should see an empty state message

  # Grid display
  Scenario: Displays grid of item cards
    Given the recent items API returns 6 items
    When I view the recent items section
    Then I should see 6 item cards

  # Card content - Name
  Scenario: Each card shows entity name
    Given the recent items API returns an item with name "My Test Prompt"
    When I view the recent items section
    Then the card should display "My Test Prompt"

  # Card content - Time
  Scenario: Each card shows relative time
    Given the recent items API returns an item with updatedAt from 5 minutes ago
    When I view the recent items section
    Then the card should display relative time text

  # Navigation
  Scenario: Clicking card navigates to entity deep link
    Given the recent items API returns an item with href "/test-project/prompts?prompt=123"
    When I click on the item card
    Then I should be navigated to "/test-project/prompts?prompt=123"

  # Tabs
  Scenario: Recents tab is selected by default
    Given the recent items API returns items
    When I view the recent items section
    Then the "Recents" tab should be active

  Scenario: Recents tab shows items ordered by date
    Given the recent items API returns items with different dates
    When I view the "Recents" tab
    Then items should be ordered by most recent first

  Scenario: By type tab groups items by entity type
    Given the recent items API returns mixed type items
    When I click the "By type" tab
    Then items should be grouped by their type

  # Error handling
  Scenario: Handles API error gracefully
    Given the recent items API returns an error
    When I view the recent items section
    Then I should see an error message
    And I should see a retry button

  Scenario: Retry button refetches data
    Given the recent items API returned an error
    When I click the retry button
    Then the API should be called again

  # Tracking
  Scenario: Card click is tracked
    Given the recent items API returns items
    When I click on an item card
    Then a tracking event should be sent for "recent_item_click"
