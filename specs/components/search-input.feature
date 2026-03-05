Feature: Standardized search input with search icon
  As a user navigating lists and pickers
  I want search fields to display a search icon
  So that I can quickly identify where to type a search query

  Background:
    Given the application renders a search input field

  # Shared SearchInput component behavior
  @unit
  Scenario: SearchInput forwards typed text to the onChange handler
    When I type "billing" into the SearchInput
    Then the onChange callback receives "billing"

  @integration
  Scenario: SearchInput renders with a search icon and placeholder
    When the SearchInput component mounts with placeholder "Search suites..."
    Then a search icon is visible inside the input
    And the placeholder "Search suites..." is visible

  # Suite sidebar uses the shared SearchInput
  @integration
  Scenario: Suite sidebar filters suites with search icon visible
    Given the suites sidebar is rendered with suites "Billing" and "Onboarding"
    When I look at the search field in the sidebar
    Then a search icon is visible inside the input
    When I type "billing" into the sidebar search field
    Then only "Billing" appears in the suite list

  # Other search fields adopt the shared component
  @integration
  Scenario: Scenario picker search field displays a search icon
    Given the scenario picker is rendered
    When I look at the search field
    Then a search icon is visible inside the input

  @integration
  Scenario: Target picker search field displays a search icon
    Given the target picker is rendered
    When I look at the search field
    Then a search icon is visible inside the input
