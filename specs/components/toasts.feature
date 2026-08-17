Feature: Toast notifications
  Toasts confirm or report the result of an action. A toast must never trap
  the user: every toast carries a close button, with no opt-out for call
  sites. The base Toaster renders the close button itself, and the create
  API rejects the old per-toast `closable` flag at the type level so a
  non-dismissable toast cannot come back.

  Toasts appear at the bottom center of the screen. The previous top-right
  position covered the close button of open drawers.

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
