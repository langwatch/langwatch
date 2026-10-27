Feature: One drawer overlay surface
  As a user
  I want drawers and their menus to share one opaque raised surface
  So that the application reads as one calm material regardless of the content behind it

  # All 1 scenario bound to drawer-backdrop.integration.test.tsx.

  Background:
    Given the application is loaded

  @integration
  Scenario: Drawer content panel shares the opaque overlay surface
    When a drawer opens
    Then the drawer content panel uses the shared overlay background
    And the drawer content panel does not blur or mix the page behind it
