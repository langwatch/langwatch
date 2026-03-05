Feature: Queue pipeline pausing
  As an operator using Skynet
  I want to pause and unpause pipeline processing
  So that I can control job execution during incidents or maintenance

  Scenario: Pause a pipeline stops job dispatch
    Given a pipeline is actively processing jobs
    When an operator pauses the pipeline via Skynet
    Then new jobs for that pipeline are not dispatched
    And already-dispatched jobs continue to completion

  Scenario: Unpause a pipeline resumes job dispatch
    Given a pipeline has been paused
    And there are pending jobs waiting for dispatch
    When an operator unpauses the pipeline via Skynet
    Then pending jobs resume dispatching

  Scenario: Pause at pipeline level pauses all job types
    Given a pipeline has multiple job types processing
    When an operator pauses at the pipeline level
    Then all job types within that pipeline stop dispatching

  Scenario: Pause at job-type level only pauses that type
    Given a pipeline has multiple job types processing
    When an operator pauses a specific job type
    Then only that job type stops dispatching
    And other job types in the same pipeline continue normally

  Scenario: Paused jobs stay in staging until unpaused
    Given a pipeline is paused
    When jobs are queued for the paused pipeline
    Then those jobs are not dispatched
    And when the pipeline is unpaused, the queued jobs dispatch immediately
