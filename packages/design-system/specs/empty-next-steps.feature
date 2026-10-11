Feature: Empty states point somewhere useful
  As someone looking at a list with nothing in it
  I want to be told where to go next
  So that an empty screen is never a dead end
  Ruling: Alex, 2026-10-11 (shapes-spec section 8, Empty states)

  @integration
  Scenario: A setting or docs next step is a link
    Given an empty state whose next step is a setting or a docs page
    Then it shows a link with the given label
    And the docs link opens in a new tab

  @integration
  Scenario: An agent prompt next step copies the prompt
    Given an empty state whose next step is a prompt for a coding agent
    When the reader presses it
    Then the prompt is on the clipboard
    And the button confirms it was copied

  @integration
  Scenario: An action next step runs the action
    Given an empty state whose next step is an action
    When the reader presses it
    Then the action runs

  @integration
  Scenario: The one-line form carries a next step too
    Given a one-line empty state with a next step
    Then the next step sits beside the sentence

  @integration
  Scenario: A page body can fill the width
    Given a page container asked to fill
    Then it is not limited to the width beside the sidebar
