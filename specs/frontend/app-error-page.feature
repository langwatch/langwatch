Feature: The application shows a branded error page when it throws

  Module host mounts compose above the routed tree, so one that throws while
  rendering takes every route with it. The reader sees the same branded card
  the sign-in doors and the waiting screen use, never a white page: a short
  title, one sentence from the presentation registry, the trace id when one is
  known, and a way out. The stack is shown on a developer's own stack only.

  @integration
  Scenario: A host mount that throws renders the branded error page
    Given a module host mount that throws while rendering
    When the application renders
    Then the reader sees the branded error page instead of an empty page
    And the page offers "Reload" and "Go home"
    And the thrown message is not shown outside development
