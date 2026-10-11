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

  @integration
  Scenario: Header tabs can stack under the heading on phones
    Given header tabs that opt in to stacking on phones
    When the header is narrower than the medium breakpoint
    Then the tabs form a full-width 36 pixel row under the heading that scrolls sideways
    And from the medium breakpoint up, and for tabs that do not opt in, the tabs keep their inline geometry

  @integration
  Scenario: Header actions wrap under the title instead of leaving the screen
    Given a header with a long title and several actions
    When the window is too narrow for the title and the actions on one line
    Then the actions wrap onto a second line and every one stays inside the window
    And the header grows to hold them, aligned to the start on a phone and the end from medium up
    And when everything fits the header keeps its single row
