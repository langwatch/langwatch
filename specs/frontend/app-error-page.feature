Feature: The application shows a branded error page when it throws

  Module host mounts compose above the routed tree, so one that throws while
  rendering takes every route with it. The reader sees the same branded card
  the sign-in doors and the waiting screen use, never a white page: a short
  title, one sentence from the presentation registry, the trace id when one is
  known, and a way out. The stack is shown on a developer's own stack only,
  collapsed until asked for. The reader can always copy the error to hand to
  support.

  @integration
  Scenario: A host mount that throws renders the branded error page
    Given a module host mount that throws while rendering
    When the application renders
    Then the reader sees the branded error page instead of an empty page
    And the page offers "Reload" and "Go home"
    And the thrown message is not shown outside development

  @integration
  Scenario: A screen that throws shows the error card inside the chrome
    Given the reader is on a screen inside the application chrome
    When the screen throws while rendering
    Then the branded error card is shown in place of the screen
    And the sidebar and top bar stay so the reader can navigate away
    And navigating to another address renders that address again

  @integration
  Scenario: The reader copies the error to hand to support
    Given a screen that throws an error carrying a trace id
    When the reader chooses "Copy error details"
    Then the clipboard holds the message, the trace id, the address, the time and the stack
    And the button reads "Copied"

  @integration
  Scenario: On a developer's own stack the error details start collapsed
    Given the application runs in development
    When a screen throws while rendering
    Then the stack is not shown until the reader opens "Error details"
    And the stack scrolls inside the card rather than overflowing it
