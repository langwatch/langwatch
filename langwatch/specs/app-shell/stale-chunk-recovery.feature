Feature: Auto-recovery from stale chunks after a deploy
  As a user with the app already open
  I want the page to recover by itself when a lazy-loaded chunk 404s after a new deploy
  So that I don't get stuck on a "Failed to fetch dynamically imported module" error

  # Background:
  # Vite emits content-hashed chunks (e.g. react-json-view-CugXrtI-.js). After a
  # deploy the old hashes are removed from the CDN, but a tab opened before the
  # deploy still references them. The next lazy import() of such a chunk 404s.
  # Route chunks already self-heal; component-level lazy imports (the JSON viewer
  # in the trace drawer, Monaco, the Foundry drawer) did not, surfacing the red
  # "Something went wrong / Try again" toast instead.

  @unit
  Scenario: A "dynamically imported module" failure is recognised as a chunk error
    Given an error whose message contains "Failed to fetch dynamically imported module"
    When the error is inspected
    Then it is classified as a chunk-load error

  @unit
  Scenario: A "Loading chunk" failure is recognised as a chunk error
    Given an error whose message contains "Loading chunk 5 failed"
    When the error is inspected
    Then it is classified as a chunk-load error

  @unit
  Scenario: An ordinary runtime error is not treated as a chunk error
    Given an error whose message is "Cannot read properties of undefined"
    When the error is inspected
    Then it is not classified as a chunk-load error

  @unit
  Scenario: The first chunk error triggers a single reload
    Given no reload has happened recently
    When a chunk-load error is handled
    Then the page reloads once
    And the reload time is recorded

  @unit
  Scenario: A second chunk error within the cooldown does not reload again
    Given a reload happened within the cooldown window
    When another chunk-load error is handled
    Then the page does not reload again

  @integration
  Scenario: A failed lazy component import reloads the page via vite:preloadError
    Given the app shell has registered its chunk-error listener
    When Vite dispatches a "vite:preloadError" event for a stale chunk
    Then the page reloads once to fetch the new chunk hashes
