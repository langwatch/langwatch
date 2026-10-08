# WHY THIS EXISTS
#
# Round 16 (.claude/coordinator/rulings-2026-10-07.md, option B): a module takes over another
# module's projection lane at the lane boundary. The owner's pipeline lives on and retires the lane;
# jobs a previous release queued under the retired key drain into the lane that took it over, so
# none is rejected for retry and lost once the last old worker exits. Same mechanism as the upcast
# drain (event-upcast.feature), whose source is a former pipeline instead of a living one.

@event-sourcing
Feature: A living pipeline hands a retired lane over to another pipeline's lane
  As a module whose projection lane another module now hosts
  I want the jobs my previous release queued under that lane to reach the new host's lane
  So that a rolling deploy neither loses nor doubles the work queued across the handover

  Background:
    Given an owner pipeline "owner_spans" that no longer declares the lanes "spanLedger" and "costTotals"
    And a host pipeline "host" that declares a peer map "spanLedger" and a peer fold "costTotals" over its events
    And the owner retires both lanes into the host's lanes of the same name

  @unit
  Scenario: A map job queued under the retired lane is delivered to the host's peer map once
    Given a job the previous release queued under "owner_spans:handler:spanLedger"
    When a worker of the new release dequeues it
    Then the host's peer map maps it exactly once
    And no job is rejected as unroutable

  @unit
  Scenario: A fold job queued under the retired lane is folded by the host's peer fold once
    Given a job the previous release queued under "owner_spans:projection:costTotals"
    When a worker of the new release dequeues it
    Then the host's peer fold folds it exactly once

  @unit
  Scenario: A pipeline that still declares a lane cannot retire it
    When an owner pipeline declares the lane "spanLedger" and also retires it
    Then building the pipeline is refused naming the pipeline and the lane

  @unit
  Scenario: A pipeline that retires no lane routes as before
    Given an owner pipeline that retires no lane
    When a job arrives under a lane key no worker registers
    Then it is rejected for retry as unroutable
