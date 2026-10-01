# Draft (2026-10-01): written to the recommended answers in .claude/handoffs/browser-read-cache-design.md;
# every scenario stays @unimplemented until Alex answers its question there.
# Extends specs/ui/browser-query-caching.feature and packages/api/specs/read-hints.feature.

Feature: The framework caches every read in the browser, so no module or screen configures caching
  A read is cached in memory and mirrored to the sealed IndexedDB store, keyed by procedure path,
  input and user, unless its contract marks it memory only. Freshness comes from the 5-minute rule,
  read hints, the session version and, later, the projection cursor. A successful write makes the
  reads of its namespace stale centrally. Each call is its own HTTP request; nothing is batched.

  Background:
    Given a browser application whose query client and transport are the framework's

  # Default

  @unimplemented
  Scenario: A read is mirrored to disk without any declaration
    Given a read whose contract declares no cache option
    When an answer for it lands in the focused tab
    Then the answer is sealed into the store under the user and the read's key

  @unimplemented
  Scenario: A read marked memory only never reaches the disk
    Given a read whose contract declares it memory only
    When an answer for it lands
    Then nothing is written to the store
    And any row the store held for it is removed

  @unimplemented
  Scenario: The session read, infinite reads and subscriptions are never mirrored
    Given the session read, an infinite read and a subscription have all answered
    When the cache is saved
    Then none of them is in the store

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

  @unimplemented
  Scenario: Switching project reads a different key and keeps the other project's rows
    Given reads for project "p1" are cached and mirrored
    When the user switches to project "p2"
    Then the reads are asked for under "p2" and nothing of "p1" is shown
    And the "p1" rows stay on disk until they are evicted

  @unimplemented
  Scenario: A different user in the same document never sees the previous user's memory cache
    Given reads were cached for one user
    When the session read names another user without a document reload
    Then the memory cache is cleared before any screen reads it

  @unimplemented
  Scenario: A read refused with 403 loses its disk row
    Given a read whose row is mirrored
    When a fetch for it is refused with HTTP 403
    Then its row is removed from the store

  # Writes

  @unimplemented
  Scenario: A successful write makes the reads of its namespace stale
    Given "scenarios.getAll" is mounted and "scenarios.getById" is cached but not mounted
    When the "scenarios.archive" write succeeds
    Then "scenarios.getAll" is refetched
    And "scenarios.getById" is marked stale without being fetched

  @unimplemented
  Scenario: A write names the other reads it makes stale on its contract
    Given the "team.create" write declares that it makes "organization.getScopeGraph" stale
    When it succeeds
    Then "organization.getScopeGraph" is refetched where it is mounted

  @unimplemented
  Scenario: A failed write makes nothing stale
    Given "scenarios.getAll" is mounted
    When the "scenarios.archive" write fails
    Then nothing is refetched

  # Cursor slot

  @unimplemented
  Scenario: A cursor-backed read sends the version on its restored row
    Given a read declared from a projection was mirrored with version "v1"
    When the document reloads and the read is revalidated
    Then the request carries since "v1"

  # One request per call

  @unimplemented
  Scenario: Every call is its own request
    Given three reads are asked for in the same tick
    When the transport sends them
    Then three HTTP requests are made, each to its own procedure path

  @unimplemented
  Scenario: Each answer carries its own session version
    Given two reads are in flight
    When the second answer carries a newer session version
    Then every read is marked stale

  @unimplemented
  Scenario: One failing call does not fail another
    Given two reads are asked for in the same tick
    When one of them fails with HTTP 500
    Then the other resolves with its data and its own status

  @unimplemented
  Scenario: A write sent as the document goes away still lands
    Given a write sent with keepalive
    When the document navigates away
    Then the request is sent with keepalive and is not cancelled

  @unimplemented
  Scenario: The host still answers a batched call from a tab on the previous build
    Given a tab still running the build before batching was removed
    When it sends a batched request within the deploy window
    Then each call in the batch is answered
