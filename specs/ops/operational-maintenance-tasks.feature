# The one-shot production tools main kept as loose scripts under
# platform/app/scripts/ops/, ported onto the task launcher so they are
# registered by name, run the same words on a laptop and in a pod, and are
# covered by tests rather than by the operator who last ran them.

Feature: Operational maintenance tasks
  As an operator cleaning up after an incident
  I want the maintenance tools registered in the task catalogue
  So that I can see what a run would do before it does it

  # Both tools delete production rows or keys. Discovery is the default for
  # exactly that reason: an operator who mistypes a namespace or a retention
  # window gets a count, not a deletion.

  @unit
  Scenario: The stranded-group reaper reports before it deletes
    Given GroupQueue groups whose jobs no dispatcher can reach
    And groups that are still ready, active or blocked
    When the reaper runs without being told to apply
    Then it reports the unreachable groups and the jobs they hold
    And it deletes nothing
    And a group still wired into the dispatch graph is never listed

  @unit
  Scenario: The stranded-group reaper leaves a briefly stranded live group alone
    Given a group missing from every state set whose newest job is minutes old
    When the reaper runs with a multi-hour minimum age
    Then that group is not listed
    And no key belonging to it is deleted

  @unit
  Scenario: The stranded-group reaper recounts pending jobs from what survives
    Given stranded groups the operator has told the reaper to apply
    When the deletions finish
    Then the pending-jobs counter is recomputed from the surviving groups
    And it is not decremented per deleted group, which would compound an existing drift

  @unit
  Scenario: The process-manager purge counts the backlog before deleting it
    Given a backlog of dispatched outbox rows and consumed inbox rows
    When the purge runs without being told to apply
    Then it reports how many rows of each are eligible
    And it deletes nothing

  @unit
  Scenario: The process-manager purge never touches work still owed
    Given pending outbox rows and dead outbox rows alongside the backlog
    When the purge runs and applies
    Then only dispatched outbox rows and consumed inbox rows are deleted
    And pending rows and dead rows are left exactly as they were

  @unit
  Scenario: An unusable retention window deletes nothing
    Given a retention window of zero days
    When the purge is asked to run
    Then it refuses before issuing any statement
    And it says what a usable value looks like
