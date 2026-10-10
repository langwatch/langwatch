Feature: Toasts stack in place
  As someone working through a burst of notices
  I want toasts to pile up in one place and open when I reach for them
  So that a run of messages never covers the screen

  @integration
  Scenario: A burst of toasts collapses into one stack
    Given the shared toaster
    When several toasts are raised
    Then they overlap as one stack with the newest in front

  @integration
  Scenario: Reaching for the stack fans it out and holds every timer
    Given a collapsed stack of toasts
    When the pointer enters the stack
    Then the cards spread a little, still overlapping
    And every timer holds until the pointer leaves

  @integration
  Scenario: Clicking the stack opens it into the full list
    Given a collapsed stack of toasts
    When the pointer enters the stack
    And the stack is clicked
    Then every card shows in the full list
    And the stack collapses again when the pointer leaves or a click lands outside it

  @integration
  Scenario: A stack says how many toasts wait behind it
    Given the shared toaster
    When more toasts are raised than the stack shows
    Then the front card says how many more wait behind it
    And up to three toasts show no count

  @integration
  Scenario: A toast shows the time it has left
    Given the shared toaster
    When a toast with a lifetime is raised
    Then it draws a bar for its lifetime
    And a toast that stays until dismissed draws none

  @unit
  Scenario: A warning or information toast keeps its tone
    Given a feature raises a toast through the shared toaster
    When the toast is a warning or information, as on main
    Then it reaches the feedback port as a warning or information
    And it is never drawn as a success
