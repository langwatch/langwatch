# See ../adrs/002-content-addressed-reuse-and-owner-retention.md
Feature: Stored-object reuse by content and owner-linked retention
  As a feature storing bytes it received in-process
  I want identical bytes stored once and kept only while an owner still holds them
  So that repeated media costs one object and expires with the data that references it

  Background:
    Given a project with object storage configured
    And the "trace_content" purpose follows the "traces" retention category

  # ===========================================================================
  # Reuse
  # ===========================================================================

  @unit
  Scenario: Identical bytes of the same purpose are stored once
    Given the project stored bytes for purpose "trace_content" as media type "image/png"
    When it stores the byte-identical content again for the same purpose and media type
    Then the answer references the first object and reports it as a duplicate
    And no second copy is written to storage
    And the project's byte count is unchanged

  @unit
  Scenario: Reuse never crosses a purpose, a media type or a project
    Given the project stored bytes for purpose "trace_content" as media type "image/png"
    When the same bytes are stored for purpose "scenario_event", or as media type "application/octet-stream", or by another project
    Then each of those stores writes its own object

  @unit
  Scenario: A deleted object is never reused
    Given the project's only object with these bytes is deleted
    When the bytes are stored again
    Then a new object is written and reported as not a duplicate

  @unit
  Scenario: A reuse adds the caller's audience
    Given an available object whose audiences omit the caller's audience
    When the caller stores the same bytes for the same purpose
    Then the object's audiences include the caller's audience

  @unit
  Scenario: An object stored before owner links is never reused for a retained purpose
    Given an available "trace_content" object that holds no owner link
    When trace "t2" stores the same bytes for the same purpose
    Then a new object is written and linked to trace "t2"
    And the older object keeps no link, so the sweep never deletes it

  # ===========================================================================
  # Owner links
  # ===========================================================================

  @unit
  Scenario: Storing for a retained purpose links the owner until its retention ends
    Given the project keeps traces for 30 days
    When trace "t1" stores bytes for purpose "trace_content"
    Then the object is linked to owner trace "t1" until 30 days from now

  @unit
  Scenario: A reuse links the new owner without shortening the first
    Given trace "t1" holds an object until day 30
    When trace "t2" stores the same bytes and its retention ends on day 10
    Then the object is linked to trace "t1" until day 30 and to trace "t2" until day 10

  @unit
  Scenario: Storing again for the same owner raises its link, never lowers it
    Given trace "t1" holds an object until day 30
    When trace "t1" stores the same bytes and its retention would end on day 10
    Then trace "t1" still holds the object until day 30

  @unit
  Scenario: A store whose owner link fails leaves no object behind
    Given new bytes for purpose "trace_content"
    When writing the owner link for trace "t1" fails
    Then the store fails
    And the new object is deleted and its bytes removed

  @unit
  Scenario: A purpose with no retention category writes no links
    When bytes are stored for purpose "scenario_event"
    Then the object has no owner links
    And the retention sweep never deletes it

  @unit @persistence
  Scenario: The memory and Postgres owner-link repositories answer alike
    Given the same links are written through either backend
    When a reader pages expired links, counts an object's live links, or recomputes a project's links
    Then both backends answer with the same links in the same order
    And neither answers with a link another project wrote

  # ===========================================================================
  # Sweep
  # ===========================================================================

  @unit
  Scenario: An object is deleted once its last owner's retention has passed
    Given an object linked to trace "t1" until yesterday and to nobody else
    When the retention sweep runs
    Then the expired link is removed
    And the object is deleted and its delivery refused
    And its provider bytes are queued for cleanup
    And bytes the provider refused to delete are removed on the upload reaper's next pass

  @unit
  Scenario: An object another owner still holds survives the sweep
    Given an object linked to trace "t1" until yesterday and to trace "t2" until next week
    When the retention sweep runs
    Then the link to trace "t1" is removed
    And the object stays available

  @unit
  Scenario: A reuse racing the sweep never references deleted bytes
    Given an object whose only link has expired
    When a store of the same bytes and the retention sweep run at the same moment
    Then either the object survives with the new link
    Or the store writes fresh bytes and references the new object

  @unit
  Scenario: The sweep is bounded and resumable
    Given more expired links than one sweep page, across two tenants
    When the sweep runs
    Then it takes one page from each tenant in turn until none is left or its time budget ends
    And a run stopped by its budget leaves the rest for the next run

  @unit
  Scenario: One tenant's failure does not stop the sweep for the others
    Given two tenants with expired links, and the first tenant's links cannot be removed
    When the sweep runs
    Then the second tenant's expired objects are deleted
    And the run fails naming the failure, and a later run finishes the first tenant

  # ===========================================================================
  # Retention changes
  # ===========================================================================

  @unit
  Scenario: Applying a shorter retention to existing traces shortens their media's links
    Given trace media linked on day 0 under a 30-day trace retention
    When the project applies a 7-day trace retention to its existing data
    Then every "trace_content" link of the project ends 7 days after it was created

  @unit
  Scenario: A re-time counts from the owner's latest store
    Given trace "t1" stored media on day 0 and the same media again on day 20
    When the project applies a 7-day trace retention to its existing data
    Then the link of trace "t1" ends on day 27

  @unit
  Scenario: Applying a longer retention to existing traces lengthens their media's links
    Given trace media linked on day 0 under a 7-day trace retention
    When the project applies a 90-day trace retention to its existing data
    Then every "trace_content" link of the project ends 90 days after it was created

  @unit
  Scenario: A retention change in another category leaves trace media alone
    When the project applies a new "scenarios" retention to its existing data
    Then no "trace_content" link changes

  @unit
  Scenario: Pinning a trace does not extend its media
    Given a pinned trace whose media is linked until day 30
    When the retention sweep runs on day 31
    Then the media is deleted, as the pinned trace's rows are

  @unit
  Scenario: Deleting a project's objects removes their links
    When the project's stored objects are deleted
    Then none of the project's owner links remain
