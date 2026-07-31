@unit
Feature: A mount states what a projection is, and illegal combinations are refused
  A projection's mount travels as one descriptor — what kind of projection it
  is, what store it writes to, how wide its lane is, and what happens when
  several updates land in the same lane at once. Some combinations of those
  choices fail quietly rather than loudly: a projection that reads its own
  prior state loses updates under concurrency if its lane is shared by more
  than one aggregate, and a store that combines rows by key silently
  double-counts a retried write unless something says how that is avoided.
  Both are decidable before a single event is processed, which is why they
  are checked when the projection is mounted rather than left to show up in
  production numbers later. (ADR-106.)

  Background:
    Given a projection is being mounted

  Scenario: a projection that reads its prior state is mounted on a lane shared by many aggregates
    Given a projection that reads its prior state before writing
    When it is mounted on a lane wider than one aggregate
    Then the mount is refused
    And the refusal explains that two concurrent updates to the same aggregate can race and lose one

  Scenario: a projection that accumulates state is told to discard everything but the latest event
    Given a projection that accumulates state across every event it sees
    When it is mounted to discard everything in its lane but the latest event
    Then the mount is refused
    And the refusal explains that a discarded event is a contribution that never arrives

  Scenario: a lane holding exactly one event is asked to gather a batch
    Given a projection whose lane holds exactly one event
    When it is mounted to gather a batch from that lane
    Then the mount is refused
    And the refusal explains that a lane of one event can never form a batch

  Scenario: a projection that reads its prior state is mounted on a store that never reads back
    Given a projection that reads its prior state before writing
    When it is mounted on a store that does not offer that state back
    Then the mount is refused
    And the refusal explains that the projection has nowhere to read its prior state from

  Scenario: a projection is mounted on a store that combines rows by their key
    Given a projection is mounted on a store whose engine combines rows sharing a key
    When the mount is checked
    Then the mount is refused
    And the refusal explains that kind of store is closed to new adopters

  Scenario: a merge-backed mount does not say how a redelivered write avoids double counting
    Given a projection is mounted on a store whose engine combines rows sharing a key
    And the mount does not say how a retried write is told apart from a fresh one
    When the mount is checked
    Then the mount is refused
    And the refusal explains that a retried write would otherwise be counted twice

  Scenario: a mount is wrong in more than one way at once
    Given a projection whose mount breaks more than one rule at once
    When the mount is checked
    Then every broken rule is reported, not only the first one found

  Scenario: a projection that reads its prior state is mounted correctly
    Given a projection that reads its prior state before writing
    When it is mounted on a lane scoped to one aggregate, on a store that reads back
    Then the mount is accepted

  Scenario: a projection that writes independent records groups its work by a declared partition
    Given a projection that writes an independent record per event
    When it is mounted on a lane scoped to a declared partition, gathering a batch
    Then the mount is accepted

  Scenario: every combination a mount could declare is either accepted or refused
    Given every combination a mount's declared choices could form
    When each one is checked
    Then each is found to be either accepted or refused, and none is left unclassified
