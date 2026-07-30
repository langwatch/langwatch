@unit
Feature: A fold declares how its state round-trips, and nothing else
  A fold that keeps its state in a durable store has exactly one piece of
  genuinely per-aggregate logic: how its working state becomes a stored record,
  and how that record becomes working state again. The two are a pair — writing
  one without the other is how a fold ends up reading back a record it cannot
  trust.

  Everything else that used to be assembled around that pair — how long the
  record is kept, which shapes of record this build can still read, what happens
  when it cannot read one, whether recent state is served from a cache, whether
  one record or many are written at a time — follows from the pair and from the
  kind of data being kept. A fold states those two things and the platform
  supplies the rest, identically for every fold, so no fold can supply them
  differently and no fold can forget one. (ADR-066.)

  Background:
    Given a fold that declares how its state is stored and recovered

  Scenario: the platform stamps how long a record is kept from the kind of data it holds
    Given a fold that keeps a kind of data its customer's plan sets a retention on
    When the fold commits a record for a customer with their own retention
    Then the record is kept for that customer's retention rather than a platform default
    And no fold has to remember to ask for that

  Scenario: a fold with no retention answer still keeps records for a bounded time
    Given a customer whose retention could not be resolved for this write
    When the fold commits a record
    Then the record is kept for the platform's default period
    And it is never kept indefinitely

  Scenario: a record written under the current shape is recovered as written
    Given an aggregate whose record was written by the fold as it stands today
    When the fold recovers that aggregate's state
    Then the recovered state is the state that was committed
    And the record's own bookkeeping about what has already been folded comes back with it

  # Superseded by ADR-101 decision 4: an unreadable record is reported as
  # found and refused, never rebuilt inline. The remedy is an operator-run
  # replay, not a fold-triggered rebuild.
  @unimplemented
  Scenario: a record written under a shape this build cannot read is rebuilt
    Given a fold that has since changed the shape of the record it keeps
    And an aggregate whose record was written under the older shape
    When the fold recovers that aggregate's state
    Then the older record is treated as no state at all
    And the bookkeeping about what has already been folded is discarded with it
    And that aggregate is rebuilt from its history rather than continued from an empty state

  Scenario: an aggregate with no record at all starts from an empty state
    Given an aggregate that has never been folded
    When the fold recovers its state
    Then it starts from an empty state
    And nothing is reported as unreadable

  # Superseded by ADR-101 decision 4: a fold is no longer required to be able
  # to rebuild what it refuses — refusal is a hard error with an operator-run
  # replay as the remedy, not a capability the fold itself must have.
  @unimplemented
  Scenario: a fold that can refuse a record can always rebuild one
    Given any fold that decides which shapes of record it can read
    Then that fold is able to rebuild an aggregate it refuses
    And a fold cannot be configured to refuse a record it has no way to rebuild

  Scenario: one shape of record that says nothing about which build wrote it is settled by the record itself
    Given a fold whose stored shape changed without the recorded shape being renamed
    And an aggregate whose record carries evidence it was written after that change
    When the fold recovers that aggregate's state
    Then the record is recovered rather than rebuilt
    And a record of the same name carrying no such evidence is rebuilt instead

  # Superseded by ADR-101 decision 4: a withdrawn shape is refused like any
  # other unreadable record, not rebuilt inline by the fold.
  @unimplemented
  Scenario: a shape whose records are known to be wrong is rebuilt even though it can be read
    Given a fold that has withdrawn a shape whose records recorded the wrong thing
    And an aggregate whose record was written under that withdrawn shape
    When the fold recovers that aggregate's state
    Then that aggregate is rebuilt rather than continued from the withdrawn record
    And records written under the shapes either side of it are still recovered

  Scenario: a record in a shape the fold has never known is rebuilt
    Given an aggregate whose record carries a shape name this fold does not recognise
    When the fold recovers that aggregate's state
    Then that aggregate is rebuilt rather than guessed at

  Scenario: changing what a fold reads back without saying so fails the build
    Given a fold that reads back a recorded set of details
    When someone changes which details it reads back without declaring a new shape
    Then the build fails and names the fold and the change

  Scenario: declaring a new shape alongside the change is accepted
    Given a fold that reads back a recorded set of details
    When someone changes which details it reads back and declares a new shape for it
    Then the build accepts the change

  Scenario: a fold cannot claim to read back a shape it has withdrawn
    Given a fold whose newest declared shape has been withdrawn as wrong
    Then declaring it is rejected outright rather than silently writing records nothing can read

  Scenario: a state with nothing worth keeping is not committed
    Given a fold that declares when its state is worth keeping
    And a state that carries no such signal yet
    When the fold commits
    Then no record is written
    And an aggregate that later gains signal is written normally

  Scenario: committing many aggregates at once matches committing them one at a time
    Given several aggregates whose states are committed together
    When the fold commits them in one go
    Then each is written exactly as it would have been on its own
    And each carries its own customer's retention and its own folding bookkeeping

  Scenario: a composite engine key is bound column by column, never collapsed to one
    Given a fold whose aggregate is identified by more than one column
    When its state is read back
    Then every part of that identity is bound separately in the lookup
    And two aggregates sharing one part are never read as the same record

  Scenario: a partition anchor cannot be re-stamped on every write
    Given a record column that anchors where the record is partitioned and when it expires
    When a fold declares that the platform should stamp it on every write
    Then the declaration is refused before anything is ever written
    And the fold is told to carry the value in its own state and freeze it on first write

  Scenario: recent state is served ahead of the store without any fold arranging it
    Given a fold whose state was committed moments ago
    When the fold recovers that aggregate's state
    Then it is served from the recent-state tier rather than the store
    And state recorded under a different shape is never served from that tier
