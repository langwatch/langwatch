Feature: Settings tables stay usable on narrow viewports
  As a user on a narrow window or with many wide columns
  I want settings tables to scroll horizontally when they overflow
  So that the right-most actions column (the three-dots menu) is always
  reachable instead of being clipped off-screen

  # The settings tables (model providers, default models, API keys, groups,
  # role bindings, secrets, SCIM, audit log, data retention, annotation
  # scores) wrap their Table.Root in a Card. When a row is wider than the
  # available width the Card must scroll horizontally; otherwise the row is
  # clipped and the actions menu in the last column cannot be opened. The
  # members page already does this (overflowX="auto" on Card.Body) and is the
  # reference pattern.

  Background:
    Given I am logged in
    And I have access to a project

  @visual
  Scenario: Model providers table actions menu is reachable when the table overflows
    Given the model providers list has rows wider than the viewport
    When I view the Model Providers settings page on a narrow window
    Then the table scrolls horizontally
    And I can scroll to and open the row actions menu

  @visual
  Scenario: Default models table is horizontally scrollable when it overflows
    Given the default models table is wider than the viewport
    When I view the Default Models section on a narrow window
    Then the table scrolls horizontally

  @visual
  Scenario: Other settings tables follow the same overflow pattern
    Given a settings table whose row content exceeds the viewport width
    When I view that settings page on a narrow window
    Then the table scrolls horizontally rather than clipping its last column
