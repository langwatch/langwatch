Feature: Ops dashboard latency tiles
  As an operator monitoring the queue platform
  I want the P50 and P99 latency tiles to reflect actual job durations
  So that I can spot slow-processing pipelines from the ops page

  Background:
    Given an admin is viewing the ops dashboard

  Scenario: P50 and P99 stay at zero when no jobs have completed
    Given no group-queue job has completed on any worker
    When the dashboard refreshes
    Then the P50 tile shows "0ms"
    And the P99 tile shows "0ms"
    And the P50 peak shows "0ms"
    And the P99 peak shows "0ms"

  Scenario: P50 and P99 reflect recent job durations after completion
    Given group-queue workers have completed several jobs with measurable durations
    When the dashboard refreshes
    Then the P50 tile shows a non-zero value
    And the P99 tile shows a value at least as large as P50
    And both peak tiles retain the highest duration yet recorded

  Scenario: Two operators reading at the same moment see the same latency
    Given two operators open the ops dashboard at the same time
    When both read the latency tiles
    Then both see the same values

  Scenario: Peaks survive a restart of the workers
    Given a peak latency has been recorded
    When the workers are restarted
    Then the peak tiles still show that value
    And no peak tile falls back to a lower one
