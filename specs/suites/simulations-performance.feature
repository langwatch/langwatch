Feature: Simulations run history performance
  The simulations views stay responsive by fetching only what each view
  renders, refreshing only when something actually changed, and rendering
  only what is on screen. Live updates arrive over the event stream;
  polling drops to a slow safety net while the stream is healthy and
  speeds up only when it is down.

  Background:
    Given a project with simulation runs

  # ── Run detail drawer ─────────────────────────────────

  Scenario: Finished run stops refreshing in the drawer
    Given the run detail drawer is open for a run that has finished
    When the drawer stays open
    Then the drawer does not re-fetch the run

  Scenario: Live run keeps refreshing in the drawer
    Given the run detail drawer is open for a run that is still executing
    When new turns are produced
    Then the drawer shows the new turns without the user reloading

  Scenario: Run details keep updating while the event stream is down
    Given the run detail drawer is open for a run that is still executing
    And the event stream is disconnected
    When new turns are produced
    Then the drawer still picks up the new turns via fallback refresh

  Scenario: Hovering a run pre-loads its details
    Given the run history shows a finished run
    When the user hovers over the run
    And then opens it
    Then the drawer opens showing the run details without a loading wait

  # ── Run history lists ─────────────────────────────────

  Scenario: A quiet set does not re-download its run history
    Given a set whose runs have all finished
    When the run history stays open
    Then the run history is not re-downloaded

  Scenario: New runs appear in the run history without reloading
    Given the run history is open
    When a new run starts in the project
    Then the new run appears in the run history

  Scenario: Active sets refresh faster than idle sets
    Given the event stream is disconnected
    When a set has runs still executing
    Then the run history checks for changes frequently
    But when all runs have settled
    Then the run history checks for changes infrequently

  Scenario: The run list loads without detail-only payloads
    Given a set with finished runs
    When the run history loads
    Then the list shows status, names, previews, duration and cost summaries
    And judge reasoning and error payloads are only loaded when a run is opened

  # ── Rendering ─────────────────────────────────────────

  Scenario: Only the most recent execution starts expanded
    Given a set with several past executions
    When the run history is opened for the first time
    Then only the most recent execution is expanded
    And older executions can be expanded manually

  Scenario: Manually collapsed executions stay collapsed
    Given the user collapsed an execution
    When the run history refreshes
    Then the execution stays collapsed

  Scenario: Newly arriving executions expand automatically
    Given the run history has already been visited
    When a new execution starts
    Then the new execution appears expanded
