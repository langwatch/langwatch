# See ../../../dev/docs/plans/peer-cycle-cuts-2026-10-06.md (S2)

Feature: Suite progress follows scenario facts

  A suite run counts its items from the run facts scenario records: a run
  started, finished, or graded again after it finished. Suite subscribes to
  those facts on its own pipeline; scenario names no suite operation. Progress
  may run seconds behind the run itself.

  @unit
  Scenario: Suite progress follows scenario facts
    Given a scenario run of a suite set
    When scenario records that the run started and then finished
    Then suite records the item started and then completed with the run's outcome

  @unit
  Scenario: A run of any other set leaves suite runs alone
    Given a scenario run of a plain scenario set
    When scenario records that the run started or finished
    Then suite records nothing

  @unit
  Scenario: A finished fact recorded before it carried the run's identity is skipped
    Given a finished fact of a suite set without its batch, scenario or status
    When suite receives it
    Then suite records nothing and the fact is not retried

  @unit
  Scenario: A changed verdict is regraded once per fact
    Given a finished suite run item
    When scenario records that its verdict moved after it finished
    Then suite regrades the item, keyed by that fact's id
    And a fact that moved nothing regrades nothing

  @unit
  Scenario: A suite pins each run's evaluators as it queues it
    Given a suite run plan with its own evaluators, over a scenario filed in a test suite
    When the suite queues the scenario's run
    Then the run carries the test suite's and the plan's evaluators with their definitions
