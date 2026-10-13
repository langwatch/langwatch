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
  Scenario: A callback action sits beside the next step, never instead of it
    Given a one-line empty state with a callback action and a next step
    When the reader presses the action
    Then the action runs
    And the next step is still shown

  @integration
  Scenario: A setting next step can route in place
    Given a setting next step with an onNavigate callback
    When the reader clicks it plainly
    Then the callback receives the href
    And a modified click is left to the browser

  @integration
  Scenario: Several next steps sit side by side
    Given an empty state with a setting, a docs page and a prompt
    Then every one of them is shown

  @integration
  Scenario: A state without a next step does not compile
    Given the empty state types that require a next step
    Then a missing or empty next step is a type error

  @integration
  Scenario: The one-line form carries a next step too
    Given a one-line empty state with a next step
    Then the next step sits beside the sentence

  @integration
  Scenario: A page body can fill the width
    Given a page container asked to fill
    Then it is not limited to the width beside the sidebar
