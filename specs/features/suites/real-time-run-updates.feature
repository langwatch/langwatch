Feature: Real-time run updates via SSE and adaptive polling
  As a user viewing suite run history
  I want new runs and status changes to appear within about one second
  So that I get near-instant feedback without unnecessary network traffic

  Background:
    Given a project with at least one suite

  # --- SSE-driven invalidation (RunHistoryList) ---

  @integration
  Scenario: New run appears immediately in suite run history when SSE event fires
    Given the RunHistoryList is mounted for a suite
    And the SSE subscription is active
    When an onSimulationUpdate event fires for that suite's scenarioSetId
    Then the run data query is refetched
    And the new run appears without waiting for the next polling interval

  @integration
  Scenario: SSE events for a different suite do not trigger refetch
    Given the RunHistoryList is mounted for suite A
    And the SSE subscription is active
    When an onSimulationUpdate event fires for suite B's scenarioSetId
    Then the run data query is not refetched

  # --- SSE-driven invalidation (AllRunsPanel) ---

  @integration
  Scenario: New run appears immediately in All Runs when SSE event fires
    Given the AllRunsPanel is mounted
    And the SSE subscription is active
    When an onSimulationUpdate event fires for any suite
    Then the All Runs data query is refetched
    And the new run appears at the top of the list

  @integration
  Scenario: SSE subscription stays active after Load More in All Runs
    Given the AllRunsPanel is mounted and showing paginated results
    When the user clicks Load More
    And an onSimulationUpdate event fires
    Then the All Runs data query is still refetched
    And new runs appear at the top of the list

  # --- Adaptive polling (RunHistoryList) ---

  @unit
  Scenario: Polling interval is fast when runs are in progress
    Given the run data contains rows with PENDING or IN_PROGRESS status
    When the polling interval is computed
    Then it is between 2 and 3 seconds

  @unit
  Scenario: Polling interval is slow when all runs are settled
    Given the run data contains only SUCCESS, FAILED, or ERROR rows
    When the polling interval is computed
    Then it is between 15 and 30 seconds

  @unit
  Scenario: Polling interval returns to fast when a new run starts
    Given the run data previously contained only settled rows
    When a row transitions to IN_PROGRESS status
    Then the polling interval drops to between 2 and 3 seconds

  # --- Adaptive polling (AllRunsPanel) ---

  @unit
  Scenario: All Runs polling interval is fast when any run is active
    Given the All Runs data contains at least one PENDING or IN_PROGRESS row
    When the polling interval is computed
    Then it is between 2 and 3 seconds

  @unit
  Scenario: All Runs polling interval is slow when all runs are settled
    Given the All Runs data contains only settled rows
    When the polling interval is computed
    Then it is between 15 and 30 seconds

  # --- Debounce and coalescing ---

  @unit
  Scenario: First SSE event triggers immediate refetch
    Given no SSE event has fired recently
    When an onSimulationUpdate event fires
    Then the refetch happens immediately without debounce delay

  @unit
  Scenario: Rapid SSE events are coalesced into a single refetch
    Given an SSE event just fired and triggered a refetch
    When three more events fire within the debounce window
    Then only one additional refetch is triggered after the debounce period

  # --- Page visibility ---

  @integration
  Scenario: SSE events are ignored when the browser tab is hidden
    Given the RunHistoryList is mounted and the browser tab is hidden
    When an onSimulationUpdate event fires
    Then the run data query is not refetched

  @integration
  Scenario: Pending updates are applied when the tab becomes visible again
    Given the browser tab was hidden and SSE events were received
    When the user switches back to the tab
    Then a refetch is triggered to pick up missed updates
