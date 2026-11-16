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
    Given more expired links than one sweep page
    When the sweep runs repeatedly
    Then each run handles at most one page per tenant
    And a run interrupted part way leaves nothing a later run cannot finish

  # ===========================================================================
  # Retention changes
  # ===========================================================================

  @unit
  Scenario: Applying a shorter retention to existing traces shortens their media's links
    Given trace media linked on day 0 under a 30-day trace retention
    When the project applies a 7-day trace retention to its existing data
    Then every "trace_content" link of the project ends 7 days after it was created

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
