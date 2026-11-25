Feature: Toasts stack in place
  As someone working through a burst of notices
  I want toasts to pile up in one place and open when I choose to read them
  So that a run of messages never covers the screen

  @integration
  Scenario: A burst of toasts collapses into one stack
    Given the shared toaster
    When several toasts are raised
    Then they overlap as one stack with the newest in front

  @integration
  Scenario: Hover lifts the peeking cards and holds every timer
    Given a collapsed stack of toasts
    When the pointer enters the stack
    Then each rear card lifts another 14 pixels without expanding the list
    And the front card stays in place
    And every timer holds until the pointer leaves

  @integration
  Scenario: Click opens the list until dismissed
    Given a collapsed stack of toasts
    When its card body is clicked
    Then every card is listed with a 12 pixel gap and its timer paused
    And leaving the stack does not collapse it
    And clicking outside or pressing Escape collapses without dismissing a toast

  @integration
  Scenario: A horizontal swipe dismisses a card without opening the stack
    Given a collapsed stack of toasts
    When its front card is dragged beyond 35 percent of its width or flicked horizontally
    Then that card flies off in the drag direction and is dismissed
    And the stack stays collapsed

  @integration
  Scenario: A short drag springs back and never counts as a click
    Given a collapsed stack of toasts
    When its front card is dragged a short distance slowly and released
    Then that card springs back to its original position
    And the stack stays collapsed

  @integration
  Scenario: Reduced motion makes stack changes immediate
    Given reduced motion is preferred
    When a toast is dragged and released
    Then returning or dismissing happens without a spring or fly-off

  @unit
  Scenario: A warning or information toast keeps its tone
    Given a feature raises a toast through the shared toaster
    When the toast is a warning or information, as on main
    Then it reaches the feedback port as a warning or information
    And it is never drawn as a success
