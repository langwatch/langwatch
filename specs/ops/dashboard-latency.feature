Feature: Ops dashboard latency tiles
  As an operator monitoring the queue platform
  I want the P50 and P99 latency tiles to reflect actual job durations
  So that I can spot slow-processing pipelines from the ops page

  Background:
    Given an admin is viewing the ops dashboard

  Scenario: P50 and P99 stay at zero when no jobs have completed
    Given no group-queue job has completed anywhere in the fleet
    When the dashboard reads the shared snapshot
    Then the P50 tile shows "0ms"
    And the P99 tile shows "0ms"
    And the P50 peak shows "0ms"
    And the P99 peak shows "0ms"

  Scenario: P50 and P99 reflect recent job durations after completion
    Given a group-queue worker has completed several jobs with measurable durations
    When the dashboard reads the shared snapshot
    Then the P50 tile shows a non-zero value
    And the P99 tile shows a value at least as large as P50
    And both peak tiles retain the highest value the fleet has observed

  Scenario: Peaks survive the writer being replaced
    Given the fleet has observed a peak latency
    When the pod holding the snapshot lease is replaced
    Then the peak tiles still show the value the fleet observed
    And they do not reset to the new writer's own history
