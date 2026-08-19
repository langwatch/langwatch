Feature: Toast notifications
  Toasts confirm or report the result of an action. A toast must never trap
  the user: every toast carries a close button, with no opt-out for call
  sites. The base Toaster renders the close button itself, and the create
  API rejects the old per-toast `closable` flag at the type level so a
  non-dismissable toast cannot come back.

  Toasts appear at the bottom center of the screen. The previous top-right
  position covered the close button of open drawers.

  In light mode a status toast wears a solid fill, which is what Chakra gives
  it: a white card on a light page reads as dead, and the status then has
  nowhere to show. In dark mode it stays a panel with one hairline in the
  status tone, where a solid fill is heavy. Whatever the surface, the status
  icon, the title and the close button sit on one line, and the close button
  keeps the same distance from the right edge as the icon keeps from the left.

  Background:
    Given the application renders the shared Toaster

  @integration
  Scenario: Every toast shows a close button
    When any part of the application creates a toast without extra options
    Then the toast shows a close button

  @integration
  Scenario: The close button dismisses the toast
    Given a toast is on screen
    When the user clicks its close button
    Then the toast goes away

  @integration
  Scenario: An error toast keeps its close button and error actions
    When an error is shown through the error toast helper
    Then the toast shows a close button
    And the toast keeps the docs link and error id actions

  @integration
  Scenario: Toasts appear at the bottom center of the screen
    When any toast is created
    Then the toast region is placed at the bottom center of the viewport

  @unit
  Scenario: A filled toast drops the accent its panel would use
    Given a status toast, which light mode fills with a solid colour
    Then its action and its icon inherit the colour the fill sets
    And on the dark panel they keep the status accent

  @unit
  Scenario: A toast that is a card in both modes keeps its accent
    Given an info or loading toast, which no mode fills
    Then its action keeps the accent, having no fill to sit on
