# Extends specs/ui/browser-query-caching.feature and packages/api/specs/read-hints.feature.
# Rows restore at start-up today; the lazy restore and the call-site lint are the tracked gaps.

Feature: The framework caches every read in the browser, so no module or screen configures caching
  A read is cached in memory and mirrored to the sealed IndexedDB store, keyed by procedure path,
  input and user, unless it is on the named exclusion list. Freshness comes from the 5-minute rule,
  read hints and the session version; a write goes stale through hints, never by hand at the call
  site. Each call is its own HTTP request; nothing is batched.

  Background:
    Given a browser application whose query client and transport are the framework's

  # Default

  @integration
  Scenario: A read is mirrored to disk without any declaration
    Given a read whose contract declares no cache option
    When an answer for it lands in the focused tab
    Then the answer is sealed into the store under the user and the read's key

  @integration
  Scenario: A read added to the exclusion list loses the row it left on disk
    Given a row on disk for a read
    When the read joins the exclusion list and the document reloads
    Then the row is not painted
    And the row is removed from the store

  @unimplemented
  Scenario: A read is restored from disk only when it is first asked for
    Given the store holds rows for two reads
    When the document reloads and a screen asks for one of them
    Then only that read is opened from the store and painted
    And it is fetched again behind the painted copy

  @unimplemented
  Scenario: A call site cannot set its own cache timing
    Given a module's browser code that passes staleTime, gcTime or refetchInterval to a read
    When the browser code is linted
    Then the lint names the call site and says the framework owns cache timing

  # Keys

  @integration
  Scenario: Switching project reads a different key and keeps the other project's rows
    Given reads for project "p1" are cached and mirrored
    When the user switches to project "p2"
    Then the reads are asked for under "p2" and nothing of "p1" is shown
    And the "p1" rows stay on disk until they are evicted

  # One request per call

  @unit
  Scenario: One failing call does not fail another
    Given two reads are asked for in the same tick
    When one of them fails with HTTP 500
    Then the other resolves with its data and its own status

  @unit
  Scenario: A write sent as the document goes away still lands
    Given a write sent with keepalive
    When the document navigates away
    Then the request is sent with keepalive and is not cancelled
