Feature: A fresh group settles briefly before it is claimed
  As the queue every fold and command runs through
  I want a group that has just received its first job to wait a few milliseconds for the jobs behind it
  So that a short trace arriving span by span is folded and stored once, not once per span

  A fresh send stages its group with a ready score of its first job plus the settling window
  (10 ms by default, the queue policy's settleWindowMs overrides it). A group that already holds
  a full batch is claimable at once, and a group already waiting keeps its earlier score. The wait
  happens in the ready score, never inside a claimed slot, and jobs keep their own scores, so the
  order inside a group and at-least-once delivery are unchanged. A window of 0 claims as before.

  Background:
    Given a GroupQueue with its Lua scripts deployed

  @integration
  Scenario: Jobs staged within the window are claimed together
    Given a settling window of a minute and a batch of up to 10 jobs
    When three jobs are sent to one group within the window
    Then the group is not claimable before the window ends
    And once the window ends one claim takes the first job with the other two due beside it

  @integration
  Scenario: A group holding a full batch is claimable at once
    Given a settling window of a minute and a batch of up to 3 jobs
    When three jobs are sent to one group
    Then the group is claimable at once

  @integration
  Scenario: A window of 0 claims a group as soon as its job is due
    Given a settling window of 0
    When a job is sent to a group
    Then the group is claimable at once

  @integration
  Scenario: A job sent to a group already waiting never delays it
    Given a group whose job is already due and waiting for a slot
    When another job is sent to that group with a settling window of a minute
    Then the group is still claimable at once

  @integration
  Scenario: Jobs staged in one batch call settle like single sends
    Given a settling window of a minute
    When two jobs for one group are staged in one batch call
    Then the group is not claimable before the window ends
    And once the window ends it is claimed

  @unit
  Scenario: The dispatcher wakes when a settling group's window ends
    Given a settling window above 0 and a group that comes due sooner than one signal wait
    When the dispatcher waits for work
    Then it claims again once the group is due, without blocking on the signal list

  @unit
  Scenario: Without a settling window the dispatcher waits on the signal list as before
    Given a settling window of 0 and a group that comes due sooner than one signal wait
    When the dispatcher waits for work
    Then it blocks on the signal list for the shortest signal wait
