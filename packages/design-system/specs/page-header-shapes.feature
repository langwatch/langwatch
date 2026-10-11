Feature: Page header actions
  As someone building a page header
  I want header actions that cannot be restyled and still link and open menus
  So that every page reads the same and links stay real links
  Rulings: dev/docs/design/guidelines.md section 4

  @integration
  Scenario: A header button that links keeps the link
    Given a header button given a link element with href, target and rel
    Then the rendered element is the link with those attributes
    And it is painted as a header button

  @integration
  Scenario: A header button opens a menu and reports it
    Given a header button composed as a menu trigger
    When the reader opens the menu
    Then the button reports that it has a popup, is expanded and names its menu

  @integration
  Scenario: A header button submits a form elsewhere on the page
    Given a header button of type submit naming a form
    Then pressing it submits that form once

  @integration
  Scenario: The closed header props reject style props
    Given the header, heading, subtitle and button prop types
    Then style props are a type error on the closed shape
    And the old open props still compile as deprecated
