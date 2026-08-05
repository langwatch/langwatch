# Add to annotation queue — Gherkin Spec
# Brings the v1 "add to annotation queue" action to the new Trace Explorer.
#
# Two entry points, one dialog. The selection bar sends every checked trace at
# once; the trace drawer's overflow menu sends the one trace it is showing.
# Both mount the same AddToAnnotationQueueDialog, which embeds the existing
# AddParticipants picker (teammates and queues, plus "Add New Queue") and calls
# the same `annotation.createQueueItem` mutation the old table called. Nothing
# is added server-side — the mutation, its permission check and the queue model
# are all unchanged.

Feature: Add traces to an annotation queue

  Reviewers hand traces to a teammate or a queue from wherever they are
  looking at them — a batch picked out of the table, or the single trace
  open in the drawer.

  Background:
    Given the user is authenticated with "annotations:manage" permission
    And the project has traces

  # ─── Bulk entry: the selection action bar ───────────────────────────────

  Rule: Adding a selection to a queue

    Scenario: The action appears once rows are selected
      When the user selects two trace rows
      Then the selection bar offers "Add to annotation queue"
      And it sits alongside "Add to dataset"

    Scenario: Sending the selection to a teammate
      Given the user has selected two trace rows
      When the user opens "Add to annotation queue"
      And picks a teammate
      And confirms the send
      Then both selected traces are queued for that teammate
      And the dialog closes
      And a confirmation appears with a way to open the queues

    Scenario: Sending the selection to a queue
      Given the user has selected two trace rows
      When the user opens "Add to annotation queue"
      And picks an existing queue
      And confirms the send
      Then both selected traces are queued in that queue

    Scenario: Creating a queue without leaving the flow
      Given the user has opened "Add to annotation queue"
      When the user chooses to add a new queue
      Then the new-queue drawer opens
      And the dialog keeps the picks already made

    Scenario: Nothing is sent until someone is picked
      Given the user has opened "Add to annotation queue"
      Then the send action stays unavailable while no teammate or queue is picked

  Rule: Explicit selection only

    Scenario: Selecting everything that matches disables the action
      Given the user has selected all traces matching the current filters
      Then "Add to annotation queue" is disabled
      And hovering it explains that the action needs rows picked one by one
      # Same rule as "Add to dataset" and "Add to context" — the all-matching
      # mode stands for up to the selection cap, far more than a review queue
      # is meant to absorb in one click.

  # ─── Single entry: the trace drawer ─────────────────────────────────────

  Rule: Adding the open trace to a queue

    Scenario: The action lives in the drawer's overflow menu
      Given the user has a trace open in the drawer
      When the user opens the overflow menu
      Then "Add to annotation queue" appears with the add-to-dataset actions

    Scenario: Sending the open trace to a queue
      Given the user has a trace open in the drawer
      When the user picks "Add to annotation queue" from the overflow menu
      And picks a teammate or a queue
      And confirms the send
      Then that one trace is queued
      And a confirmation appears with a way to open the queues

  # ─── Permissions ────────────────────────────────────────────────────────

  Rule: Only reviewers who can manage annotations see the action

    Scenario: The selection bar hides the action
      Given the user cannot manage annotations
      When the user selects two trace rows
      Then the selection bar does not offer "Add to annotation queue"
      And the other bulk actions still render

    Scenario: The overflow menu hides the action
      Given the user cannot manage annotations
      And the user has a trace open in the drawer
      When the user opens the overflow menu
      Then "Add to annotation queue" is not listed

  # ─── Personal workspaces ────────────────────────────────────────────────

  Rule: Personal workspaces turn the feature on from where it is used

    Scenario: Annotations are off on the user's own personal workspace
      Given the user is on their own personal workspace with annotations off
      And the user has selected two trace rows
      When the user picks "Add to annotation queue"
      Then the user is asked to enable the advanced features first
      And accepting takes them straight on to the queue dialog

    Scenario: Declining leaves the selection untouched
      Given the user has been asked to enable the advanced features
      When the user declines
      Then no dialog opens
      And the selection is unchanged
