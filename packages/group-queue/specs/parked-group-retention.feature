Feature: A parked group keeps its jobs for as long as it is parked
  As an operator running the GroupQueue under a per-tenant in-flight cap
  I want a group parked at its tenant's cap, or behind a paused lane, to keep its jobs
  So that a tenant held back for hours loses no work to the stranded-group
  reaper or to the group-key safety-net TTL.

  A parked group is out of ready, active and blocked by design: it waits in
  parked:<tenant> or parked-lane:<pause entry> until a slot frees or the pause
  lifts. Parking clears the TTL on its jobs and data keys, a write while it is
  parked leaves them without one, and leaving the parked set restores it.

  Background:
    Given the GroupQueue is running with Lua scripts deployed

  @unit
  Scenario: The stranded-group reaper never deletes a parked group
    Given a group parked at its tenant's cap whose newest job is older than the cutoff
    And a group parked behind a paused lane whose newest job is older than the cutoff
    And a group in no dispatch set whose newest job is older than the cutoff
    When the reaper runs with apply
    Then it lists and deletes only the group in no dispatch set

  @integration
  Scenario: A group parked at its tenant's cap survives a reap past the cutoff
    Given a group parked at its tenant's cap
    When the reaper applies seven hours after its jobs were staged
    Then the group's jobs and data are untouched
    And a stranded group in the same namespace is deleted

  @integration
  Scenario: A parked group's keys carry no expiry while it waits
    Given a group parked at its tenant's cap
    Then its jobs and data keys have no TTL

  @integration
  Scenario: A stage into a parked group does not re-arm the expiry
    Given a group parked at its tenant's cap
    When another job is staged into the group
    Then its jobs and data keys still have no TTL

  @integration
  Scenario: An unparked group gets its safety-net expiry back
    Given a group parked at its tenant's cap
    When the tenant's running group completes and frees the slot
    Then the parked group is back in ready
    And its jobs and data keys carry the safety-net TTL again

  @integration
  Scenario: A group parked behind a paused lane keeps its keys
    Given a group parked behind a paused lane
    Then its jobs and data keys have no TTL
    And the reaper applied past the cutoff deletes nothing

  @integration
  Scenario: A stage into a group parked behind a paused lane does not re-arm the expiry
    Given a group parked behind a paused lane
    When another job is staged into the group
    Then its jobs and data keys still have no TTL

  @integration
  Scenario: An unpaused lane's group gets its safety-net expiry back
    Given a group parked behind a paused lane
    When the lane is unpaused and the dispatcher runs
    Then the lane's parked set is empty
    And the group's jobs and data keys carry the safety-net TTL again

  @integration
  Scenario: The stranded-group reaper deletes a group only if it is still stranded
    Given a group the reaper discovered as stranded
    When, before the delete, it enters ready, active, blocked or a parked set, or gains a newer job
    Then the delete re-checks it in the same step and leaves its jobs and data whole
    And a group still stranded at the delete has its jobs and data keys deleted
