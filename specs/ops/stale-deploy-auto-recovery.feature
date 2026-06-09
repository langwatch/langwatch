Feature: Stale-deploy auto-recovery
  The SPA serves each route as a content-hashed chunk. When a new version is
  deployed the old chunk hashes are purged, so a tab opened before the deploy
  hits a "Failed to fetch dynamically imported module" error on its next lazy
  import. The app should recover itself by reloading — but only when a reload
  will actually help (a newer deploy is live), never blindly (which would loop
  forever on a persistent failure like an ad-blocker or an offline network).

  Background:
    Given the tab booted with a content-hashed entry chunk

  Scenario: A chunk fails and a newer deploy is live
    Given a lazy chunk fails to load
    And the server is serving a newer entry than this tab booted with
    When the app handles the chunk error
    Then the app reloads itself to pick up the fresh chunk hashes
    And the user is not left on the error boundary

  Scenario: A chunk fails but no newer deploy is available
    Given a lazy chunk fails to load
    And the server is serving the same entry this tab booted with
    When the app handles the chunk error
    Then the app does not keep reloading
    And the user is shown the error boundary with a manual reload escape hatch

  Scenario: The user returns to a tab left open across a deploy
    Given the tab was hidden while a new deploy shipped
    When the tab becomes visible again
    Then the app detects the newer deploy and reloads before the user navigates into a purged chunk

  Scenario: The server reports a newer deploy that a reload does not resolve
    Given the app already reloaded targeting a given deployed entry
    And the server still reports that same entry as newer afterwards
    When the app would reload again for that entry
    Then it does not reload (no infinite loop)

  Scenario: Running in development without content-hashed chunks
    Given the booted entry is not a content-hashed asset
    When the app checks for a newer deploy
    Then it reports no newer deploy and changes nothing
