Feature: Show a stalled scenario run for what it is
  As a LangWatch user
  I want a run that will never finish to be clearly distinguished from an active run
  So that I understand when a run has died rather than waiting on it

  # Context: when a worker dies (OOM, container kill, redeploy) the run's own
  # "finished" report never arrives. Without something ending it, the run
  # appears to be in progress forever.
  #
  # STALLED USED TO BE DERIVED AT READ TIME AND IS NOW STORED. `resolveRunStatus`
  # compared a run's last event against a threshold on every read and returned
  # STALLED without writing anything, so the stored status and the displayed
  # status disagreed by design and nothing downstream ever fired. ADR-073
  # replaced it: the `scenarioExecution` process manager arms a durable
  # deadline that the run's own progress re-arms, and writes STALLED as the
  # run's terminal status when one fires. The derivation and its last consumer
  # are gone.
  #
  # What ends a run therefore belongs to
  # specs/scenarios/scenario-execution-process-manager.feature (the deadline and
  # the shutdown that beats it on a deploy). What is left here is what the user
  # sees once a run carries that status — still an E2E gap.

  # ============================================================================
  # End-to-End - User Workflow
  # ============================================================================

  @e2e @unimplemented
  Scenario: User sees a stalled indicator for a run that never completed
    Given I am logged into project "my-project"
    And scenario "Flaky Agent" had a run whose worker disappeared
    And the run has since been recorded as stalled
    When I view the run history for "Flaky Agent"
    Then I see the run displayed with a stalled warning indicator
    And the run is not shown as actively in progress
    And I can distinguish it from runs that failed with an error
