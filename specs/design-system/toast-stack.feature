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
  Scenario: Reaching for the stack lists every card and holds every timer
    Given a collapsed stack of toasts
    When the pointer enters the stack
    Then the cards list one above another
    And every timer holds until the pointer leaves

  @unit
  Scenario: A warning or information toast keeps its tone
    Given a feature raises a toast through the shared toaster
    When the toast is a warning or information, as on main
    Then it reaches the feedback port as a warning or information
    And it is never drawn as a success
