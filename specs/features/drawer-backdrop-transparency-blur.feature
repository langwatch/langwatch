Feature: Drawer backdrop transparency and blur
  As a user
  I want drawers to be semi-transparent with a blur effect
  So that I can maintain spatial context of the content behind the drawer

  # Parity status: 0 of 1 scenarios bound to existing tests.
  # The remaining are tracked under #3458:
  #   - 1 NO_TEST: behavior shipped + correct, no integration test yet exists
  # NO_TEST gaps:
  #   - "Drawer content panel applies blur filter and transparency"

  Background:
    Given the application is loaded

  @integration @unimplemented
  Scenario: Drawer content panel applies blur filter and transparency
    When a drawer opens
    Then the drawer content panel has a backdrop-filter with 25px blur
    And the drawer content panel background uses 80% opacity
