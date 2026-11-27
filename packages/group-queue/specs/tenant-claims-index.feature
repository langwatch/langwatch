Feature: GroupQueue lists each tenant's claimed groups
  As a projection replay waiting for work already admitted to a paused lane
  I want the queue to tell me which of a tenant's groups still run
  So that the wait costs a few reads instead of a walk over every key in Redis (ADR-092)

  A claim adds its group to the tenant's set, keyed by the group id's first segment. Completion
  removes it. A read returns the members under a group-id prefix whose active key or claimed
  record still exists, and drops the members with neither, so expiry, a dead worker and any
  release the scripts do not track heal on read. Groups without a tenant segment are not listed.

  Background:
    Given a GroupQueue with its Lua scripts deployed

  @integration
  Scenario: A claimed group is listed under its tenant until it completes
    Given a job of a tenant's group is claimed
    When the tenant's claimed groups are read
    Then the group is listed
    And after the job completes, the group is no longer listed

  @integration
  Scenario: A group waiting out a retry backoff is still listed
    Given a claimed job is restaged for a retry, so its claimed record goes and its active key stays
    When the tenant's claimed groups are read
    Then the group is listed

  @integration
  Scenario: Only the asked projection's groups are returned
    Given claimed groups of two projections of one tenant
    When the claimed groups under one projection's prefix are read
    Then only that projection's group is returned

  @integration
  Scenario: A group whose keys are gone leaves the index on the next read
    Given a listed group whose active key and claimed record are both gone
    When the tenant's claimed groups are read
    Then the group is not returned and no longer listed

  @integration
  Scenario: The backfill lists claims an older worker made
    Given a claimed group missing from the index, as a previous release would leave it
    When the backfill walks the keyspace in paced steps to the end
    Then the group is listed

  @integration
  Scenario: A heartbeat keeps the tenant's claim list alive
    Given a claimed group of a tenant whose claim list is close to expiring
    When the worker's heartbeat refreshes the claim
    Then the claim list's expiry is pushed back to the claim records' key lifetime

  @integration
  Scenario: A dead worker's surviving claim stays listed
    Given a claimed group whose active key expired while its claimed record remains
    When the tenant's claimed groups are read
    Then the group is still listed
