Feature: An identifier is an aggregate - one stream per identifier
  As the LangWatch platform
  I need each sign-in identifier to own its event stream instead of sharing
  one stream with every other identifier the same person holds
  So that two ceremonies about two different identifiers stop serialising
  against each other, and a fold costs one identifier rather than a person

  # ADR-127, on top of ADR-101 (the identity pipeline) and ADR-110 (a grant
  # is an aggregate - the same move, one domain over).
  #
  # What changes is the aggregate ID, not the aggregate TYPE. The type is the
  # storage partition key and the event store rejects an event whose type
  # differs from the one its pipeline declares, so `user_identity` stays
  # exactly as it is on a log that already carries live events. Under it:
  #
  #   aggregateId = identifierId   one identifier's lifecycle
  #   aggregateId = userId         what is about the PERSON and not an
  #                                identifier: two-step verification (D06),
  #                                a link proposal, the erasure record
  #
  #   tenantId    = userId         UNCHANGED. The user is still the tenant of
  #                                their own identity history, so erasure
  #                                stays a single tenant scan (ADR-029 §4)
  #                                and both the old and the new streams are
  #                                inside it.
  #
  # A shared stream was carrying two things. One was SERIALISATION - the
  # queue keys its lane on the aggregate id - and that is what we are
  # deliberately giving up. The other was two cross-identifier SWEEPS the
  # reducer performed on state no per-identifier fold can see: demoting every
  # standing PRIMARY, and wiping every head on erasure. Both survive by being
  # ROUTED rather than swept: the command reads the person's heads - a filter
  # over the projection, ADR-110's answer to the same problem in offboarding -
  # and states one fact per stream that has to move.
  #
  # This file specifies the routing and the per-identifier fold, which is the
  # domain half. Wiring it (the envelope, the command lanes, the per-identifier
  # cursor, the restatement of the existing log) is the slices ADR-127 lists.

  Background:
    Given a user "sam" who holds identifiers "work" and "personal"

  @unit
  Scenario: An identifier's own facts route to its own stream
    When an attach, a verify, a dead end or a detach is stated for "work"
    Then the fact is routed to the stream of "work" and to no other
    And the stream is named by the identifier, so the person is not the key

  @unit
  Scenario: A promotion routes a demotion to the identifier losing PRIMARY
    Given "personal" is PRIMARY and "work" is VERIFIED
    When a primary change promoting "work" is stated
    Then the fact is routed to the stream of "work" and the stream of "personal"
    And each stream folds the copy it receives into its own half of the change

  @unit
  Scenario: A first primary change routes one stream only
    Given "sam" holds no PRIMARY identifier
    When a primary change promoting "work" is stated
    Then the fact is routed to the stream of "work" alone
    And no demotion is stated, because nothing was demoted

  @unit
  Scenario: The demoted stream folds a promotion of somebody else into a demotion
    Given the head of "personal" is PRIMARY
    When it folds a primary change that promotes "work" and names it as previous
    Then "personal" returns to VERIFIED
    And nothing else about the head moves

  @unit
  Scenario: A head that is not PRIMARY is untouched by somebody else's promotion
    Given the head of "personal" is VERIFIED
    When it folds a primary change that promotes "work"
    Then nothing about the head moves at all

  # The fold demotes whatever standing PRIMARY it is handed, so "exactly one
  # PRIMARY" is only as true as the routing is complete. That is why the
  # command names every standing holder rather than the one it happens to
  # remember - it is the last moment anything can see the whole person.
  @unit
  Scenario: Exactly one PRIMARY survives, whoever was standing
    Given a partial-window replay left "work" and "personal" both PRIMARY
    When a promotion of a third identifier is stated
    Then it states a demotion naming each of them
    And no standing PRIMARY is left for the fold to find later

  @unit
  Scenario: Erasure routes one fact per identifier the person actually holds
    When an erasure is stated for "sam"
    Then the fact is routed to the stream of every identifier the heads carry
    And to the person's own stream, so an erasure with no identifiers is still recorded
    And the routed list comes from a read of the whole person, not from a caller's list

  @unit
  Scenario: An erased stream keeps its row, its domain and its dates
    When the head of "work" folds an erasure
    Then its value and its identifier hash are null
    And its domain, its state and its timestamps are exactly what they were

  @unit
  Scenario: A proposal names no identifier, so it stays on the person's stream
    When a link proposal is stated for "sam"
    Then the fact is routed to the person's stream and to no identifier stream
    And it moves no head, because a proposal states that no identifier arrived

  @unit
  Scenario: Folding one identifier's stream never reads another identifier
    When the head of "work" folds its whole stream
    Then every state it reaches is decided by that stream alone
    And no fact naming another identifier changes it

  @unit
  Scenario: A verify for a head that does not exist yet folds to nothing
    Given the stream of "work" has no attach in the window being folded
    When a verify for "work" is folded
    Then the head stays absent, and nothing throws

  @unit
  Scenario: Re-applying an attach never regresses the head
    Given the head of "work" is VERIFIED
    When the attach that created it is folded again
    Then the head stays VERIFIED

  @unit
  Scenario: A tombstone never resurrects on its own stream
    Given the head of "work" is DETACHED
    When a verify for "work" is folded
    Then the head stays DETACHED and keeps its value

  @unit
  Scenario: The per-identifier fold and the per-user fold agree on a whole history
    Given a history of attaches, verifies, a primary change and a detach for "sam"
    When the history is folded per-identifier over the streams it routes to
    Then every head equals the head the per-user reducer produces
    And the two reducers can therefore replace each other one identifier at a time

  @unit
  Scenario: The tenant is still the person
    When any identity fact is routed
    Then the tenant of every stream is the user, whatever the aggregate id is
    And erasure over the log is still one tenant scan, covering both streams
