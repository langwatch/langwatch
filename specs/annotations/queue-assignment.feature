# Assigning traces to annotators — the shared write path.
#
# One service method backs two callers that look nothing alike:
#   - the queue UI's bulk "send these traces to these queues" mutation, where
#     breadth is whatever the reviewer selected on the page, and
#   - the ADD_TO_ANNOTATION_QUEUE automation action, which replays a stored
#     trigger's `actionParams` from inside the process-manager outbox.
#
# The second caller is why the failure modes below are specified rather than
# left to the boundary: an error shaped for a browser means nothing to an
# operator reading a dead-lettered outbox row, and a fan-out sized for one
# request starves every other request sharing the connection pool.

Feature: Assigning traces to annotators
  Reviewers and automations put traces on a queue or a person's worklist,
  without one bulk assignment monopolising the database on the way.

  Background:
    Given a project whose annotation queues and members belong to that project

  # --- Golden path ---

  @unit
  Scenario: Every selected trace is assigned to every chosen annotator
    Given 3 traces and 2 annotators
    When the traces are assigned
    Then a queue item is written for each of the 6 trace-and-annotator pairs

  @unit
  Scenario: A repeated annotator is assigned once, not twice
    Given the same annotator appears twice in one request
    When the traces are assigned
    Then one queue item is written per trace for that annotator

  @unit
  Scenario: Re-assigning a completed trace re-opens its queue item
    Given a trace already assigned to an annotator and marked done
    When the trace is assigned to that annotator again
    Then the existing item is re-opened rather than duplicated

  # --- Breadth ---

  @unit
  Scenario: A bulk assignment never runs more writes at once than the bound
    Given 40 traces and 3 annotators
    When the traces are assigned
    Then the writes still all complete
    And no more than the bounded number of writes are ever in flight at once

  @unit
  Scenario: An assignment far larger than any page of traces is rejected
    Given a request naming more traces than the largest page a reviewer can select
    When the assignment is submitted
    Then it is rejected before any queue item is written

  # --- Failure modes ---

  @unit
  Scenario: An annotator from another project assigns nothing at all
    Given one annotator in the request belongs to a different project
    When the traces are assigned
    Then no queue item is written for any trace in the request

  @unit
  Scenario: An annotator that names neither a queue nor a person is refused by code
    Given an annotator string carrying neither a queue nor a person prefix
    When the traces are assigned
    Then the failure carries the stable "invalid_annotator_reference" code
    And it says a person can fix it
    And no queue item is written

  @unit
  Scenario: A stored automation's unusable annotator retires instead of retrying
    Given an annotation-queue automation whose stored annotator names neither a queue nor a person
    When the outbox dispatches that automation's action
    Then the failure is marked terminal so the message is not retried
    And the operator's log names the trigger that needs fixing
