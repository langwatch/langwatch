@unit
Feature: An event's type string is persisted forever, so a rename orphans stored rows
  An aggregate's declared event types become the type string written onto
  every stored event of that shape, and that string is read back for the whole
  retention window. Renaming or dropping the declaration that produced it does
  not touch what is already on disk: the rows are still there, still carrying
  the old string, but nothing knows how to fold them into state any more.
  Nothing at compile time catches this, because the declaration with the new
  name is, on its own, perfectly well-typed.

  The ratchet is the check that turns that silent orphaning into a visible
  diff. It compares what was declared last time against what is declared now
  and reports any string that disappeared, so the loss is something a reviewer
  reads rather than something a customer discovers when their history stops
  replaying. Additions never trigger it, because a new type string never
  orphans anything that already exists. (ADR-105.)

  Background:
    Given a committed snapshot of the type strings every aggregate has declared

  Scenario: a new event type on an existing aggregate is free
    Given an aggregate that keeps every type string it declared last time
    When that aggregate declares one further type string
    Then the ratchet reports nothing

  Scenario: a brand-new aggregate is never a violation
    Given a declaration for an aggregate the snapshot has never seen before
    When the ratchet compares the snapshot against the current declarations
    Then the new aggregate's type strings are never reported

  Scenario: a first-ever snapshot commits without complaint
    Given no snapshot has ever been committed
    When the ratchet compares that empty snapshot against whatever is declared now
    Then everything declared now is accepted

  Scenario: renaming a map key orphans the stored rows carrying the old string
    Given an aggregate whose declaration renames one of its type strings
    When the ratchet compares the snapshot against the current declarations
    Then the old string is reported as missing under that aggregate

  Scenario: dropping an aggregate entirely orphans every one of its stored event types
    Given an aggregate that the current declarations no longer mention at all
    When the ratchet compares the snapshot against the current declarations
    Then every type string that aggregate ever declared is reported as missing

  Scenario: the committed file gains only what was added
    Given a snapshot and a set of current declarations that adds new type strings
    When the snapshot is merged with the current declarations
    Then the merged result carries every type string from both, deduplicated
    And nothing that was already committed is lost

  Scenario: a merge that changes nothing produces a byte-identical result
    Given a snapshot that has already been merged with the current declarations
    When that same merge is run again against its own result
    Then the result is unchanged
