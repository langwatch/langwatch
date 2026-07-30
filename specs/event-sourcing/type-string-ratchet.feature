@unit
Feature: A persisted type string is kept forever, so a rename orphans stored rows
  A pipeline's declared event keys, and a process manager's declared intent
  keys, become the type strings written onto every stored event and every
  outbox row of that shape, and those strings are read back for the whole
  retention window. Renaming or dropping the declaration that produced one
  does not touch what is already on disk: the rows are still there, still
  carrying the old string, but nothing knows how to route them any more.
  Nothing at compile time catches this, because the declaration with the new
  name is, on its own, perfectly well-typed.

  The ratchet is the check that turns that silent orphaning into a visible
  diff. It compares what was declared last time against what is declared now
  and reports any string that disappeared, so the loss is something a
  reviewer reads rather than something a customer discovers when their
  history stops replaying. Additions never trigger it, because a new type
  string never orphans anything that already exists. One implementation
  covers both kinds — an event's type and an intent's — because the
  comparison is the same shrink-only diff over a snapshot keyed by
  declaration name, whichever kind of string it holds. (ADR-105 decision 10.)

  Background:
    Given a committed snapshot of the type strings every declaration produced

  Scenario: a new event type on an existing declaration is free
    Given a declaration that keeps every type string it declared last time
    When that declaration declares one further type string
    Then the ratchet reports nothing

  Scenario: a brand-new declaration is never a violation
    Given a declaration the snapshot has never seen before
    When the ratchet compares the snapshot against the current declarations
    Then the new declaration's type strings are never reported

  Scenario: a first-ever snapshot commits without complaint
    Given no snapshot has ever been committed
    When the ratchet compares that empty snapshot against whatever is declared now
    Then everything declared now is accepted

  Scenario: renaming a map key orphans the stored rows carrying the old string
    Given a declaration that renames one of its type strings
    When the ratchet compares the snapshot against the current declarations
    Then the old string is reported as missing under that declaration

  Scenario: dropping a declaration entirely orphans every one of its stored type strings
    Given a declaration that the current declarations no longer mention at all
    When the ratchet compares the snapshot against the current declarations
    Then every type string that declaration ever produced is reported as missing

  Scenario: an intent's type string is ratcheted the same way an event's is
    Given a process manager that renames one of its declared intent keys
    When the ratchet compares the snapshot against the current declarations
    Then the old intent type is reported as missing under that process manager

  Scenario: the committed file gains only what was added
    Given a snapshot and a set of current declarations that adds new type strings
    When the snapshot is merged with the current declarations
    Then the merged result carries every type string from both, deduplicated
    And nothing that was already committed is lost

  Scenario: a merge that changes nothing produces a byte-identical result
    Given a snapshot that has already been merged with the current declarations
    When that same merge is run again against its own result
    Then the result is unchanged
