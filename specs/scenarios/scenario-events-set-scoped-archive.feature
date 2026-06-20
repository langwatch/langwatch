Feature: Scoped DELETE /api/scenario-events
  As an SDK or self-serve user
  I want DELETE /api/scenario-events to require a scenario set scope
  So that I cannot accidentally archive every simulation run in a project,
  and so I get an honest result when the operation is partial.

  # ============================================================================
  # Integration: Required scenarioSetId query param (AC 1)
  # ============================================================================

  @integration @unimplemented
  Scenario: DELETE without scenarioSetId returns 400
    Given I am authenticated in project "test-project"
    When I call DELETE /api/scenario-events with no query parameters
    Then I receive a 400 Bad Request response
    And the error message names "scenarioSetId" as the missing parameter
    And no simulation runs are archived

  @integration @unimplemented
  Scenario: DELETE with empty scenarioSetId returns 400
    Given I am authenticated in project "test-project"
    When I call DELETE /api/scenario-events?scenarioSetId=
    Then I receive a 400 Bad Request response
    And the error message names "scenarioSetId" as the missing parameter
    And no simulation runs are archived

  # ============================================================================
  # Integration: Set-scoped archive isolates other sets (AC 6)
  # ============================================================================

  @integration @unimplemented
  Scenario: Archiving one set leaves runs in other sets untouched
    Given I am authenticated in project "test-project"
    And 3 un-archived simulation runs exist in scenario set "set-a"
    And 3 un-archived simulation runs exist in scenario set "set-b"
    When I call DELETE /api/scenario-events?scenarioSetId=set-a
    Then the response is 200 OK
    And the response body reports "archived" equal to 3
    And the response body reports "failed" equal to 0
    And the response body reports "scenarioSetId" equal to "set-a"
    And the response body reports "hasMore" equal to false
    And the 3 runs in scenario set "set-a" are archived
    And the 3 runs in scenario set "set-b" remain un-archived

  @integration @unimplemented
  Scenario: Archiving an unknown scenario set succeeds with zero counts
    Given I am authenticated in project "test-project"
    And no simulation runs exist in scenario set "ghost-set"
    When I call DELETE /api/scenario-events?scenarioSetId=ghost-set
    Then the response is 200 OK
    And the response body reports "archived" equal to 0
    And the response body reports "failed" equal to 0
    And the response body reports "hasMore" equal to false

  # ============================================================================
  # Integration: default set coalesces empty and "default" ScenarioSetId (AC 6)
  # ============================================================================

  @integration @unimplemented
  Scenario: Archiving the "default" set archives both default and empty ScenarioSetId rows
    Given I am authenticated in project "test-project"
    And 2 un-archived simulation runs exist with ScenarioSetId "default"
    And 2 un-archived simulation runs exist with ScenarioSetId ""
    And 2 un-archived simulation runs exist in scenario set "set-a"
    When I call DELETE /api/scenario-events?scenarioSetId=default
    Then the response is 200 OK
    And the response body reports "archived" equal to 4
    And both the "default" and "" ScenarioSetId rows are archived
    And the 2 runs in scenario set "set-a" remain un-archived

  # ============================================================================
  # Integration: Per-run failures are collected, not short-circuited (AC 3, AC 4)
  # ============================================================================

  @integration @unimplemented
  Scenario: Per-run failures are reported, not short-circuited
    Given I am authenticated in project "test-project"
    And 5 un-archived simulation runs exist in scenario set "set-a"
    And dispatching deleteRun fails for 2 of those runs
    When I call DELETE /api/scenario-events?scenarioSetId=set-a
    Then the response is 200 OK
    And the response body reports "archived" equal to 3
    And the response body reports "failed" equal to 2
    And the 3 successful runs are archived
    And each failure is logged with projectId, scenarioRunId, and error

  # ============================================================================
  # Integration: 10k cap surfaced via hasMore (AC 2, AC 4)
  # ============================================================================

  @integration @unimplemented
  Scenario: Reaching the 10k cap reports hasMore true
    Given I am authenticated in project "test-project"
    And the run-id query for scenario set "big-set" is configured with a cap of 10
    And 12 un-archived simulation runs exist in scenario set "big-set"
    When I call DELETE /api/scenario-events?scenarioSetId=big-set
    Then the response is 200 OK
    And the response body reports "archived" plus "failed" equal to 10
    And the response body reports "hasMore" equal to true

  @integration @unimplemented
  Scenario: Below the cap reports hasMore false
    Given I am authenticated in project "test-project"
    And 5 un-archived simulation runs exist in scenario set "small-set"
    When I call DELETE /api/scenario-events?scenarioSetId=small-set
    Then the response is 200 OK
    And the response body reports "hasMore" equal to false

  # ============================================================================
  # Integration: Project isolation
  # ============================================================================

  @integration @unimplemented
  Scenario: DELETE only archives runs in the caller's project
    Given I am authenticated in project "project-a"
    And 3 un-archived simulation runs exist in scenario set "set-a" in project "project-a"
    And 3 un-archived simulation runs exist in scenario set "set-a" in project "project-b"
    When I call DELETE /api/scenario-events?scenarioSetId=set-a
    Then the response body reports "archived" equal to 3
    And only the project "project-a" runs are archived
    And the project "project-b" runs remain un-archived

  # ============================================================================
  # Integration: Unfiltered code path is removed (AC 5)
  # ============================================================================

  @integration @unimplemented
  Scenario: Unfiltered project-wide archive endpoint no longer exists
    Given I am authenticated in project "test-project"
    And simulation runs exist in multiple scenario sets in the project
    When I call DELETE /api/scenario-events with no query parameters
    Then I receive a 400 Bad Request response
    And no project-wide archive code path can be invoked
    And no simulation runs are archived

  # ============================================================================
  # Integration: OpenAPI documentation (AC 7)
  # ============================================================================

  @integration @unimplemented
  Scenario: OpenAPI documents scenarioSetId as required and the new response shape
    Given the OpenAPI spec for the route is generated
    When I inspect DELETE /api/scenario-events
    Then "scenarioSetId" is documented as a required query parameter
    And the 200 response schema includes "archived", "failed", "scenarioSetId", and "hasMore"
    And the 400 response schema describes the missing-parameter error
    And the description notes that "default" archives current runs for the implicit set
    And the description notes that future SDK runs without an explicit setId will repopulate the default set

  # ============================================================================
  # Unit: Cap-reached signal from the repo (AC 2)
  # ============================================================================

  @unit @unimplemented
  Scenario: getRunIdsForSet reports reachedCap true at exactly the cap
    Given the repository is configured with cap N
    And N run ids match the set filter
    When I call getRunIdsForSet
    Then the response includes N run ids
    And reachedCap is true

  @unit @unimplemented
  Scenario: getRunIdsForSet reports reachedCap false below the cap
    Given the repository is configured with cap N
    And fewer than N run ids match the set filter
    When I call getRunIdsForSet
    Then the response includes fewer than N run ids
    And reachedCap is false

  # ============================================================================
  # Unit: hasMore derivation (AC 4)
  # ============================================================================

  @unit @unimplemented
  Scenario: hasMore is true when archived plus failed equals the cap
    Given the cap is 10000
    And archived equals 9990 and failed equals 10
    When the response is built
    Then hasMore is true

  @unit @unimplemented
  Scenario: hasMore is false when archived plus failed is below the cap
    Given the cap is 10000
    And archived equals 5000 and failed equals 0
    When the response is built
    Then hasMore is false

  # ============================================================================
  # Unit: Bounded concurrency dispatch (AC 3)
  # ============================================================================

  @unit @unimplemented
  Scenario: Dispatch limits in-flight deleteRun calls to the configured concurrency
    Given a concurrency limit of 8
    And 32 run ids to dispatch
    When the dispatch runs
    Then no more than 8 deleteRun calls are in flight at any moment
    And all 32 run ids are dispatched exactly once

  @unit @unimplemented
  Scenario: Dispatch does not short-circuit on a failed deleteRun
    Given a concurrency limit of 8
    And 4 run ids where the second one fails
    When the dispatch runs
    Then all 4 run ids are attempted
    And the failure is collected, not thrown

  # --- AC Coverage Map ---
  # AC 1 ("DELETE requires scenarioSetId; missing → 400"):
  #   - Scenario: DELETE without scenarioSetId returns 400
  #   - Scenario: DELETE with empty scenarioSetId returns 400
  # AC 2 ("New repo method getRunIdsForSet with expandSetIdFilter, 10k cap"):
  #   - Scenario: Archiving the "default" set archives both default and empty ScenarioSetId rows
  #   - Scenario: Reaching the 10k cap reports hasMore true
  #   - Scenario: getRunIdsForSet reports reachedCap true at exactly the cap
  #   - Scenario: getRunIdsForSet reports reachedCap false below the cap
  # AC 3 ("Replace Promise.all with bounded-concurrency dispatch via pMapLimited"):
  #   - Scenario: Per-run failures are reported, not short-circuited
  #   - Scenario: Dispatch limits in-flight deleteRun calls to the configured concurrency
  #   - Scenario: Dispatch does not short-circuit on a failed deleteRun
  # AC 4 ("Collect per-run failures; return { archived, failed, scenarioSetId, hasMore }"):
  #   - Scenario: Archiving one set leaves runs in other sets untouched
  #   - Scenario: Per-run failures are reported, not short-circuited
  #   - Scenario: Reaching the 10k cap reports hasMore true
  #   - Scenario: Below the cap reports hasMore false
  #   - Scenario: hasMore is true when archived plus failed equals the cap
  #   - Scenario: hasMore is false when archived plus failed is below the cap
  # AC 5 ("Remove the unfiltered code path entirely"):
  #   - Scenario: Unfiltered project-wide archive endpoint no longer exists
  # AC 6 ("Integration test: two sets in one project; default matches '' and 'default'"):
  #   - Scenario: Archiving one set leaves runs in other sets untouched
  #   - Scenario: Archiving the "default" set archives both default and empty ScenarioSetId rows
  # AC 7 ("OpenAPI doc updated: required param + response shape + default note"):
  #   - Scenario: OpenAPI documents scenarioSetId as required and the new response shape
