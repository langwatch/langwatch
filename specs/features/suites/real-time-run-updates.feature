Feature: Real-time run updates via SSE and adaptive polling
  As a user viewing suite run history
  I want new runs and status changes to appear within about one second
  So that I get near-instant feedback without unnecessary network traffic

  Background:
    Given a project with at least one suite

  # --- SSE-driven invalidation (RunHistoryList) ---

  @integration @unimplemented
  Scenario: New run appears immediately in suite run history when SSE event fires
    Given the RunHistoryList is mounted for a suite
    And the SSE subscription is active
    When an onSimulationUpdate event fires for that suite's scenarioSetId
    Then the run data query is refetched
    And the new run appears without waiting for the next polling interval

  @integration @unimplemented
  Scenario: SSE events for a different suite do not trigger refetch
    Given the RunHistoryList is mounted for suite A
    And the SSE subscription is active
    When an onSimulationUpdate event fires for suite B's scenarioSetId
    Then the run data query is not refetched

  # --- SSE-driven invalidation (AllRunsPanel) ---

  @integration @unimplemented
  Scenario: New run appears immediately in All Runs when SSE event fires
    Given the AllRunsPanel is mounted
    And the SSE subscription is active
    When an onSimulationUpdate event fires for any suite
    Then the All Runs data query is refetched
    And the new run appears at the top of the list

  @integration @unimplemented
  Scenario: SSE subscription stays active after Load More in All Runs
    Given the AllRunsPanel is mounted and showing paginated results
    When the user clicks Load More
    And an onSimulationUpdate event fires
    Then the All Runs data query is still refetched
    And new runs appear at the top of the list

  # --- Adaptive polling (RunHistoryList) ---

  @unit @unimplemented
  Scenario: First SSE event triggers immediate refetch
    Given no SSE event has fired recently
    When an onSimulationUpdate event fires
    Then the refetch happens immediately without debounce delay

  @unit @unimplemented
  Scenario: Rapid SSE events are coalesced into a single refetch
    Given an SSE event just fired and triggered a refetch
    When three more events fire within the debounce window
    Then only one additional refetch is triggered after the debounce period

  # --- Page visibility ---

  @integration @unimplemented
  Scenario: SSE events are ignored when the browser tab is hidden
    Given the RunHistoryList is mounted and the browser tab is hidden
    When an onSimulationUpdate event fires
    Then the run data query is not refetched

  @integration @unimplemented
  Scenario: Pending updates are applied when the tab becomes visible again
    Given the browser tab was hidden and SSE events were received
    When the user switches back to the tab
    Then a refetch is triggered to pick up missed updates
