Feature: Beta Pill Indicator
  As a product user
  I want to see a visual indicator when a feature is in beta
  So that I understand the feature's maturity level and can learn more on hover

  Background:
    Given a feature area wrapped with the BetaPill component

  @integration
  Scenario: Beta pill badge appears next to wrapped content
    When the page renders
    Then a "Beta" pill badge is visible alongside the wrapped content

  @integration
  Scenario: Hovering the beta pill shows a popover with the message
    Given a custom message component is provided
    When the user hovers over the beta pill
    Then a popover appears displaying the custom message content

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
    Then a popover appears displaying the custom message content

  @integration
  Scenario: Suites page displays a beta indicator
    Given I am on the Suites page
    When I look at the page header
    Then I see a "Beta" pill badge next to the Suites heading
    And hovering over it shows information about the beta status
