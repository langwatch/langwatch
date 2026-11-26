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
  Scenario: An object whose bytes are gone is never reused
    Given the project's only object with these bytes has lost its provider bytes
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
  Scenario: A store whose retention started earlier links the owner from that start
    Given the project keeps traces for 30 days
    When trace "t1" stores bytes on day 0 for a span that started on day -20
    Then the object is linked to owner trace "t1" until day 10
    And a later re-time counts from day -20

  @unit
  Scenario: A retention start in the future links the owner from now
    Given the project keeps traces for 30 days
    When trace "t1" stores bytes on day 0 for a span that starts on day 5
    Then the object is linked to owner trace "t1" until day 30

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

  @unit
  Scenario: One object's failure does not stop the sweep for the rest of its tenant
    Given two objects of one tenant with expired links, and the first object's row cannot be updated
    When the sweep runs
    Then the second object is deleted and its links removed
    And the first object keeps its links, the run fails, and a later run deletes it

  @unit
  Scenario: The sweep's tenant list starts with the longest-waiting ended link
    Given more tenants with ended links than one run takes
    When the sweep runs every hour while the first tenants keep getting new ended links
    Then the tenant whose ended link waited longest is taken first, so no tenant waits forever

  @unit
  Scenario: A re-time during the sweep still lets the sweep delete the object
    Given an object whose ended link the sweep found while another owner still held it
    When a retention change ends that other link before the sweep removes the ended links
    Then the object keeps one ended link, never none
    And the next sweep deletes the object and removes its links

  @unit
  Scenario: A sweep that fails before deleting an object never strands it
    Given an object whose only link has ended
    When the sweep fails while deleting the object
    Then the object keeps its ended link, so it is never left available with no link
    And the next sweep deletes the object

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
  Scenario: A raise never shortens a media link
    Given trace media linked on day 0 until day 90, and the trace policy is now 30 days
    When the project's stored rows are raised to the 30-day policy
    Then the link still ends on day 90

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

  # ===========================================================================
  # Objects stored before owner links
  # ===========================================================================

  @unit
  Scenario: Trace media stored before owner links is linked to the trace that stored it
    Given available "trace_content" objects that hold no owner link, in a project that keeps traces for 30 days
    When the background step "trace:link-unowned-trace-media" runs for the project
    Then each object is linked to the owner it was stored for, until 30 days after its creation
    And the sweep deletes it once that time has passed
    And a project that keeps traces forever links its objects with no end
    And an object that already holds a link, a deleted object or a purpose with no retention category is left alone
    And a second run links nothing

  @unit
  Scenario: A trace retention change during the trace media backfill fails the step by name
    Given a project whose trace retention changes while "trace:link-unowned-trace-media" links its media
    When the step finishes its pass
    Then the step fails, naming the project and both retentions
    And it asks for the project's trace retention to be applied to existing data again
