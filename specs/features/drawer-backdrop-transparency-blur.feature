Feature: Drawer backdrop transparency and blur
  As a user
  I want drawer backdrops to be semi-transparent with a blur effect
  So that I can maintain spatial context of the content behind the drawer

  Background:
    Given the application is loaded

  @integration
  Scenario: Drawer backdrop applies blur filter and transparency
    When a drawer opens
    Then the backdrop has a backdrop-filter with blur
    And the backdrop background uses an alpha-transparent color

  @integration
  Scenario: Backdrop is rendered automatically when a drawer opens
    When a drawer opens
    Then a backdrop overlay element is present in the DOM

  @integration
  Scenario: Backdrop can be opted out per drawer
    When a drawer opens with backdrop disabled
    Then no backdrop overlay is rendered
