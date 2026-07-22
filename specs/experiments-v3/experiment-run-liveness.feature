Feature: Experiment runs always reach a terminal state
  An experiment run is watched by a durable process for as long as it is
  producing results. If the work behind it disappears, the run is recorded as
  failed instead of staying started forever. (ADR-062.)

  Background:
    Given an experiment with a dataset and evaluators

  # --- Liveness ---

  Scenario: Results keep a running experiment alive
    Given an experiment run that is producing results
    When it keeps producing results for longer than the silence allowed
    Then the run is not failed for inactivity

  Scenario: An experiment run whose work disappears is failed
    Given an experiment run that has started
    When the work behind it stops producing results and never completes
    Then the run is reported as failed
    And the reason given is that it stalled

  Scenario: An abandoned interactive run is recorded as failed
    Given an interactive experiment run streaming to a browser
    When the process running it is lost
    Then the run is reported as failed
    And it does not stay reported as running

  Scenario: Recovery does not depend on a cached progress record
    Given an experiment run whose cached progress has expired
    When the run is read
    Then its outcome is still reported

  # --- Dispatch ---

  Scenario: A run started without a listener executes on the fleet
    Given an experiment run started for automated use
    When the request that started it has returned
    Then the run continues on the fleet
    And its outcome is recorded

  Scenario: An interactive run keeps streaming to its listener
    Given an interactive experiment run
    When results are produced
    Then they are streamed to the listener as they arrive

  # --- Stopping ---

  Scenario: Stopping a run ends it
    Given an experiment run that is executing
    When the user stops it
    Then the work is signalled to stop
    And the run is reported as stopped

  Scenario: A stop that is never observed still ends the run
    Given an experiment run whose work cannot be signalled
    When the user stops it
    Then the run still reaches a terminal state

  # --- Completion ---

  Scenario: A completed run stops being watched
    Given an experiment run that completes normally
    When its completion is recorded
    Then no further deadline is armed for it
    And it is not failed afterwards for inactivity
