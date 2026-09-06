@unit
Feature: Fold read windows are declared, not hand-rolled
  A fold whose backing table is time-partitioned wants its read-back pruned to
  a window of partitions around the event being folded. The window's width and
  its miss handling are platform concerns declared once on the fold definition
  — not a hint every store forwards by hand and every repository widens with
  its own arithmetic and its own (sometimes forgotten) fallback. A forgotten
  fallback is how a live aggregate reads back as null and a partial batch
  permanently overwrites the complete row. (ADR-066; companion to
  fold-read-back-store.feature.)

  Background:
    Given a fold projection whose state is persisted in a time-partitioned table

  Scenario: a declared read window bounds the store read
    Given the fold declares a read window
    When an event is folded
    Then the store read is bounded to the declared window around the event's business time
    And the store applies the window it was given without choosing a width of its own

  Scenario: a windowed miss retries unwindowed before treating the aggregate as new
    Given the fold declares a read window
    And an aggregate whose committed row sits outside that window
    When its next event is folded
    Then the platform retries the read once without the window
    And the retry does not consult the read cache again
    And the recovered state is folded onto, not replaced
    And the recovery is counted so a drifting window is visible

  Scenario: a row the store found but refused is not read again unwindowed
    Given the fold declares a read window
    And a committed row the store finds but refuses because it was written under an older shape
    When its next event is folded
    Then the platform does not retry the read without the window
    And the refusal is not reported as a window that needs widening

  Scenario: a genuinely new aggregate still starts empty
    Given the fold declares a read window
    And an aggregate that has never been folded
    When its first event arrives
    Then the windowed read and the unwindowed retry both find nothing
    And the fold starts from an empty state

  Scenario: a fold without a declared window reads unbounded
    Given the fold declares no read window
    When an event is folded
    Then the store read carries no window
    And no retry is attempted on a miss

  Scenario: an event without a usable business time reads unbounded
    Given the fold declares a read window
    When an event with no business time is folded
    Then the store read carries no window

  # Trusting absence (ADR-066 follow-up). The rescue machinery above exists
  # because "no row" was ambiguous: a store could decline to persist a state, so
  # absence proved nothing and every miss had to pay an unwindowed scan and, for
  # folds that configure one, a replay of the aggregate's history. Once a store
  # always writes what it commits, absence becomes proof that nothing was ever
  # committed, and a fold may declare that it trusts it. A refusal is not an
  # absence, so it keeps the full rescue path.

  Scenario: a trusted absent miss reads once and folds from init
    Given the fold declares a read window and trusts an absent miss
    And an aggregate that has never been folded
    When its first event arrives
    Then the windowed read is the only read the platform issues
    And the fold starts from an empty state

  Scenario: a trusted absent miss neither retries nor replays event_log
    Given the fold declares a read window and trusts an absent miss
    And the fold is configured to replay its history when the store misses
    When an event is folded and the store reports the state absent
    Then the platform does not retry the read without the window
    And it does not replay the aggregate's history
    And the skipped rescue is counted so the saving is visible

  Scenario: the batch path takes the same shortcut
    Given the fold declares a read window and trusts an absent miss
    When a batch of events is folded and the store reports the state absent
    Then the batch path skips the rescue exactly as a single event does

  Scenario: undecodable stays outside the trusted-absence claim
    Given the fold declares a read window and trusts an absent miss
    And a committed row the store finds but refuses because it was written under an older shape
    When its next event is folded
    Then the platform still runs the full rescue path
    And trusting absence is not credited for a refusal

  Scenario: a hit is untouched by the option
    Given the fold declares a read window and trusts an absent miss
    And the aggregate's row lies inside the window
    When its next event is folded
    Then the state is read and folded onto exactly as it is without the option

  Scenario: the kill switch restores the rescue machinery
    Given the fold declares a read window and trusts an absent miss
    And trusting absence is switched off for the platform
    When an event is folded and the store reports the state absent
    Then the unwindowed retry and the history replay both happen again

  Scenario: the default keeps the correctness net
    Given the fold declares a read window and does not mention trusting absence
    When an event is folded and the store reports the state absent
    Then the unwindowed retry still happens

  # Trusting absence is only sound for a fold whose aggregates stay near the
  # window in time, and only while a refusal remains distinguishable from an
  # absence. Both are structural, so both are settled before any event is
  # folded rather than discovered when a row goes missing.

  Scenario: a trusted fold's windowed read is backed by a time-local lifetime
    Given a fold that trusts an absent miss on a windowed read
    When the platform registers it
    Then the registration is refused unless the fold's aggregates are time-local
    And a fold whose aggregate can stay live indefinitely may not trust absence

  # Registration cannot settle the second one: by then the fold's store is
  # behind the shared cache wrapper, which answers for a durable tier it may
  # not have. So the pairing is checked against the store the pipeline names,
  # and the build is what refuses it.

  Scenario: trusting absence must not orphan the undecodable net
    Given a fold that trusts an absent miss and replays its history when the store misses
    When the fold is paired with the store the pipeline gives it
    Then the pairing is refused unless that store can report a row it refused
    And a refusal keeps the replay that a trusted absence skips
