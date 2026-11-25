Feature: A trace shortcut is taught beside the action it operates
  As someone reading traces
  I want each key shown where its action lives, with a small searchable list behind the question mark
  So that I learn shortcuts in use and no hint ever promises a key that does nothing

  @integration
  Scenario: The Usage view shows the key its handler really uses
    Given a coding-agent trace in the drawer
    When the view tabs render
    Then Usage shows S and exposes it as its keyboard shortcut
    And no tab shows U

  @integration
  Scenario: A view tab that is unavailable advertises no shortcut
    Given a view tab that is disabled while a trace is being annotated
    Then it still holds its place but exposes no keyboard shortcut

  @integration
  Scenario: The shortcut list is compact, neutral and searchable
    Given the keyboard shortcuts list is open
    Then it has a search field named Find a shortcut
    And it draws grouped rows with no coloured category bands
    And the live drawer shortcuts are all listed with their keys

  @integration
  Scenario: Search matches an action, a key and a scope
    Given the keyboard shortcuts list is open
    When the reader searches for an action, a key name or where a key works
    Then only the matching rows remain
    And a search with no match says no shortcuts match

  @integration
  Scenario: Escape closes only the shortcut list
    Given the keyboard shortcuts list is open and the reader has typed in its search
    When the reader presses Escape
    Then the list closes once

  @integration
  Scenario: Focus returns to a surviving opener
    Given the control that opened the list has since left the page
    When the list closes
    Then focus lands on the named fallback control

  @integration
  Scenario: The find buttons teach their keys while the find field is focused
    Given the find bar is open
    Then Next match, Previous match and Close find expose their keys
    And the find field is described by an instruction naming Enter, Shift plus Enter and Escape
