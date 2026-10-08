Feature: Stuck queue groups are cleared by the app, not by a script
  As an operator of any LangWatch install, self-hosted included
  I want groups no worker will ever pick up cleared on a schedule and on request
  So that Redis does not bloat with jobs nothing will run.

  # On main only a hand-run script (scripts/ops/reap-stranded-group-keys.sh)
  # did this. Self-hosters cannot run pnpm or scripts, so ops reaps on an hourly
  # schedule and the Queue screen offers the same reap to an operator holding
  # ops:manage. A stranded group is one whose job set exists but sits in none
  # of the ready, active or blocked sets; only groups stranded six hours or
  # more are deleted, so a group briefly between sets is left alone.

  @unit @queue @schedule
  Scenario: Stranded groups are reaped every hour as a scheduled process
    Given Ops's group-queue reaper pipeline is installed
    When the scheduler wakes the reaper
    Then one reap is requested for that wake
    And a redelivered wake requests no second reap

  @unit @queue @schedule
  Scenario: A failed scheduled reap waits for the next wake
    Given Redis refuses the reap
    When the scheduled reap runs
    Then the failure is logged and the process does not fail

  @unit @queue
  Scenario: Clearing stuck groups deletes groups stranded six hours or more and reports what it freed
    Given two groups have been stranded for more than six hours
    When an operator clears stuck groups
    Then the reap asks only for groups stranded six hours or more
    And the operator gets the stranded, deleted and failed counts and the pending total

  @unit @queue
  Scenario: Clearing stuck groups surfaces a Redis failure to the operator
    Given Redis refuses the reap
    When an operator clears stuck groups
    Then the operator sees the failure rather than an empty report

  @unit @queue
  Scenario: The memory tier has no stuck groups to clear
    Given ops runs on its memory repositories
    When an operator clears stuck groups
    Then the report says nothing was stranded

  @unit @queue
  Scenario: The Queue screen reports what clearing stuck groups freed
    Given a reap deleted two of three stuck groups and one delete failed
    Then the operator reads the groups cleared, the failure and the pending count

  @unit @queue
  Scenario: The Queue screen says when no stuck groups were found
    Given a reap found nothing stranded
    Then the operator reads that no stuck groups were found
