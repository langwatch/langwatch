# Trace list Annotations column — Gherkin Spec
# Implementation:
#   packages/features/trace/web/src/ui/sections/explorer/trace-table/registry/cells/trace/annotations-cell.tsx
#   packages/features/trace/web/src/ui/sections/explorer/hooks/use-trace-list-annotations.ts
#   packages/features/annotation/web/src/annotation-scores-chip.tsx
#
# Annotations are what reviewers left on a trace, and they live in Postgres,
# while everything else on a row comes from the trace summary in ClickHouse.
# The two are never joined in a query: the list reads the reviews of the traces
# on screen and lays them over the rows it already has.

Feature: Trace list Annotations column
  As a reviewer scanning the trace list
  I want each row to show what my team left on that trace
  So that I can see which traces are reviewed, and what was said, without opening them

Rule: The column shows what reviewers left on the trace
  A row carries what a review leaves behind: what was written, what was
  suggested instead, how it was scored and how it was rated. Each is a count
  that opens the writing itself, so a page of traces stays scannable. The
  counts read the same feed the annotations list reads, so the two never
  disagree about a trace.

  Background:
    Given the user is authenticated with "traces:view" and "annotations:view" permission
    And the Annotations column is visible

  @integration
  Scenario: A trace someone commented on shows a comment count
    Given two reviewers commented on a trace
    When the trace list renders
    Then that row's Annotations column counts 2 comments

  @integration
  Scenario: A trace with a better output suggested shows a suggestion count
    Given a reviewer suggested a better output for a trace
    When the trace list renders
    Then that row's Annotations column counts 1 suggestion

  @integration
  Scenario: A scored trace counts the scores given, not the reviews that gave them
    Given one reviewer scored a trace against two of the project's scores
    When the trace list renders
    Then that row's Annotations column counts 2 scores

  @unit
  Scenario: A score reads by its name, not by its id
    Given a reviewer scored a trace against a score named "goodness"
    When the reader opens the scores on that row
    Then the score reads as "goodness", never as the id it is stored under
    And the reason they gave for it reads with it

  @unit
  Scenario: A score a reviewer left blank is not a score they gave
    Given a reviewer opened a score key and answered nothing on it
    When the row counts the scores
    Then that key is not among them

  @integration
  Scenario: A comment left on one part of a trace still counts on its row
    Given a reviewer commented on one span of a trace rather than on the whole trace
    When the trace list renders
    Then that row counts the comment

  @integration
  Scenario: A reviewer who left only a rating still shows the rating
    Given a reviewer rated a trace and wrote nothing
    When the trace list renders
    Then that row shows the rating rather than the empty marker
    # The empty marker is a claim that nobody has looked at the trace.

  @integration
  Scenario: A trace nobody has annotated shows the empty marker
    Given nobody has annotated a trace
    When the trace list renders
    Then that row's Annotations column shows the empty-cell marker

Rule: The column fills itself in without holding up the list
  Reviews are read from another store than the rest of the row, so they arrive
  after it. Until they do, and if they never do, the column says which of those
  two it is rather than answering for the trace.

  Background:
    Given the user is authenticated with "traces:view" and "annotations:view" permission

  @integration
  Scenario: Annotations are read for the traces currently on screen
    Given the Annotations column is visible
    When a page of traces loads
    Then the reviews of those traces are read, and of no others

  @integration
  Scenario: Hiding the Annotations column costs nothing
    Given no visible column needs annotations
    When a page of traces loads
    Then the list does not go looking for annotations

  @integration
  Scenario: Enabling the Annotations column fills it in place
    Given the Annotations column was hidden
    When the user enables the Annotations column
    Then the traces already on screen gain their reviews
    And the rest of the list is not reloaded

  @integration
  Scenario: The list still renders while annotations are in flight
    Given the annotations have not arrived yet
    Then every other column renders its value
    And the Annotations column shows a pending placeholder rather than the empty marker
    # Showing the empty marker early would read as "nobody reviewed this trace".

  @integration
  Scenario: A failed annotations read says so rather than reading as empty
    Given the annotations could not be loaded
    Then the trace rows still render
    And the Annotations column reads as unavailable, not as empty
    And no error toast interrupts the user

  @integration
  Scenario: A new annotation reaches the row without a reload
    Given a reader annotates a trace that is on screen
    Then the row's counts take the new annotation in
    # The column reads the same feed every annotation write already invalidates.

  @integration
  Scenario: Onboarding sample traces are not looked up
    Given the user is seeing the onboarding sample traces
    Then no annotations are looked up for them

  @integration
  Scenario: A page with no traces on it looks nothing up
    Given the visible page has no traces
    Then no annotations are looked up

Rule: Reading a team's reviews takes permission to see them
  Annotations are a team's own judgements. A reader who may not see them is not
  offered the column, and a row never quietly reports that a reviewed trace was
  never reviewed.

  Background:
    Given the user is authenticated with "traces:view" but not "annotations:view"

  @integration
  Scenario: The column is not offered to a reader who may not see annotations
    When the user opens the column picker
    Then the Annotations column is not among the columns they can add

  @integration
  Scenario: A reader who may not see annotations never asks for them
    Given the Annotations column is somehow visible
    When a page of traces loads
    Then no annotations are looked up
    And the column reads as unavailable rather than as empty
