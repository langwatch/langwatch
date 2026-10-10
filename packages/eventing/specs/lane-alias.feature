# WHY THIS EXISTS
#
# Round 49 E4 (.claude/coordinator/rulings-2026-10-07.md, Alex, 2026-10-08): head workers also
# consume the previous release's lane keys for every lane that moved or was renamed, for one
# release, so jobs its workers staged before the cut are processed rather than rejected, retried
# and blocked. The successor's pipeline declares the alias, so ownership stays in its module. Same
# mechanism as the upcast drain (event-upcast.feature) and round 16's retired lanes, whose source
# is a whole former pipeline or a living owner instead of one former lane key.

@event-sourcing
Feature: A successor lane also consumes the key a previous release queued its jobs under
  As a module whose lane moved or was renamed in this release
  I want the jobs the previous release queued under the old key to reach my lane
  So that a rolling deploy neither loses them nor blocks their group

  Background:
    Given a successor pipeline "successor" with a peer subscriber "spanSync" on "lw.owner.span_received"
    And a peer subscriber "originSync" on "lw.owner.origin_resolved"

  @unit
  Scenario: A subscriber job queued under a renamed key is processed by its successor
    Given the successor aliases "owner:subscriber:spanSync" to its peer subscriber "spanSync"
    And a job the previous release queued under "owner:subscriber:spanSync"
    When a worker of the new release dequeues it
    Then the successor's peer subscriber handles the event once
    And no job is rejected as unroutable

  @unit
  Scenario: A reactor job queued under a former key reaches its successor with the event it carried
    Given the successor aliases "owner:reactor:spanSync" to its peer subscriber "spanSync"
    And a job the previous release queued under "owner:reactor:spanSync" carrying the event and its fold state
    When a worker of the new release dequeues it
    Then the successor's peer subscriber handles the event it carried

  @unit
  Scenario: A former lane split across successors reaches the one that takes its event type
    Given the successor aliases "owner:reactor:triggerMatch" to "spanSync" for "lw.owner.span_received"
    And to "originSync" for "lw.owner.origin_resolved"
    When a worker of the new release dequeues an "lw.owner.origin_resolved" job queued under "owner:reactor:triggerMatch"
    Then "originSync" handles it and "spanSync" does not

  @unit
  Scenario: A former job body the successor does not read is upcast by the alias
    Given the successor aliases "owner:job:deferredSync" to its command lane with a transform of the body
    And a job the previous release queued under "owner:job:deferredSync" with its own body
    When a worker of the new release dequeues it
    Then the successor's command runs with the transformed body

  @unit
  Scenario: An aliased job whose event type no successor takes is acknowledged with a log line
    Given the successor aliases "owner:reactor:triggerMatch" to "spanSync" for "lw.owner.span_received" only
    When a worker of the new release dequeues an "lw.owner.origin_resolved" job queued under that key
    Then the job is acknowledged and a log line names it
    And no handler runs and its group is not blocked

  @unit
  Scenario: A former lane may be succeeded by a subscriber of the global projections
    Given the successor aliases "global:reactor:billingMeter" to its global lane "meterCount"
    Then the lane the alias looks for is "global:reactor:meterCount", after its own and its peer lane

  @unit
  Scenario: A tombstoned former lane has its jobs acknowledged with the reason logged
    Given the successor tombstones "owner:job:deferredSync" with a reason
    When a worker of the new release dequeues a job queued under that key
    Then the job is acknowledged and the log line carries the reason
    And no handler runs and its group is not blocked

  @unit
  Scenario: A job under a key no alias names still retries and blocks
    Given no pipeline aliases "owner:subscriber:gone"
    When a worker of the new release dequeues a job the previous release queued under it
    Then the job is rejected for retry as unroutable
    And once its retries are spent it blocks its group, since it carries no routing of its own

  @unit
  Scenario: An alias that could never apply is refused when the pipeline is built
    When a pipeline aliases a key that is not "<pipeline>:<jobType>:<name>", or its successor's own key
    Or two of its aliases take the same event type from one key
    Or an alias names no release that ends it
    Then building the pipeline refuses, naming the pipeline and the key

  @unit
  Scenario: An alias past its release is refused so it gets removed
    Given an alias that ends after release "3.21.0"
    When release "3.21.0" or a later one has been cut
    Then the window check names the alias, its pipeline and its key
    And before that release it names nothing
