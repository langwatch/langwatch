Feature: Beta Pill Indicator
  As a product user
  I want to see a visual indicator when a feature is in beta
  So that I understand the feature's maturity level and can learn more on hover

  Background:
    Given a BetaPill component that renders a "Beta" badge with a hover popover

  @integration
  Scenario: Beta pill badge renders with default message
    Given a menu item configured with beta set to true
    When the item renders
    Then a "Beta" pill badge is visible next to the label

  @integration
  Scenario: Beta pill badge renders with custom message
    Given a menu item configured with beta set to a custom string
    When the user hovers over the beta pill
    Then a popover appears displaying the custom string

  @integration
  Scenario: Popover renders styled text
    Given a BetaPill with a message containing styled text
    When the user hovers over the beta pill
    Then the popover renders the styled text

  @integration
  Scenario: Popover renders clickable links
    Given a BetaPill with a message containing a link
    When the user hovers over the beta pill
    Then the link inside the popover is clickable

  @integration
  Scenario: Keyboard focus shows the popover
    When the user focuses the beta pill with the keyboard
    Then a popover appears displaying the message content

  @integration
  Scenario: Suites sidebar item displays a beta indicator
    Given the Suites menu item has beta configured with a disclaimer message
    When I view the sidebar navigation
    Then I see a "Beta" pill badge next to the Suites label
    And hovering over it shows the beta disclaimer
