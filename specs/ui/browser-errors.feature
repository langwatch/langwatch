# Implementation:
#   modules/rum/contract/src/rum.config.ts
#   packages/react-rum/src/browserErrors.ts
#   packages/react-rum/src/browserTracing.ts

Feature: The browser reports its own errors to the backend through RUM
  Browser tracing is on for every deployment unless RUM_ENABLED is "false" (and a
  collector exists to receive it). While it runs, `console.error`, `window.onerror`
  and unhandled rejections leave the tab as `browser.error` spans on the session,
  through the same same-origin export as every other browser span (ADR-058).

  Only a scrubbed message is sent: bounded in length, once per minute per message,
  with query strings, fragments and credentials removed.

  @unit
  Scenario: RUM is on by default
    Given a deployment that names a collector and does not set RUM_ENABLED
    When rum projects its browser config
    Then browser tracing is enabled with a sample ratio of 1

  @unit
  Scenario: A console error reaches the backend once per minute per message
    Given browser tracing has started
    When the page logs the same console error twice within a minute
    Then the original console.error runs both times
    And exactly one "browser.error" span is exported for it
    And the same message is exported again in the next minute

  @unit
  Scenario: Query strings and long messages are stripped
    When a browser error names a URL with a query string or fragment, a credential, or runs past the cap
    Then the exported message has no query string, fragment or credential
    And it is cut to the length cap
    And an object argument is named by its type, never printed

  @unit
  Scenario: Page loads and fetches export their URLs without query strings
    When the page loads, or calls a URL with a query string or fragment
    Then the exported span records that URL without its query string or fragment

  @unit
  Scenario: Browser telemetry names a share link by its route
    When the page loads, navigates to or calls a share link
    Then every exported span name and URL attribute shows the share path as "/share/:id"
