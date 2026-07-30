@unit
Feature: A fold must reach the same state whatever order it sees events in
  Events are stamped in a customer's process and cross a network before we see
  them, so the stream is already unordered when it arrives. No amount of
  discipline on our side can restore an order that was lost before the first
  byte reached us — a strict order imposed downstream would be a strong-looking
  promise over a shuffled input.

  So the requirement moves to the fold. A fold is admissible only if its state is
  a function of the *set* of events it has seen, not of the sequence. Where that
  holds, order stops being something to guarantee and becomes something that
  cannot matter. Where it does not, the fold produces a different answer
  depending on which delivery happened to arrive first, and nothing downstream
  can tell that it did.

  This is checked rather than asserted. Every fold that previously claimed its
  accumulators commuted carried that claim in a comment, and on most of them the
  claim had never been tested. (ADR-098.)

  Background:
    Given a fold that folds a series of events into a state

  Scenario: a fold that only accumulates is unaffected by order
    Given every field either counts, sums, or keeps the largest value it has seen
    When the same events are folded in different orders
    Then every order reaches the same final state

  Scenario: a fold whose status only ever moves forward is unaffected by order
    Given a status that can advance but never retreat
    When a later stage arrives before an earlier one
    Then the state settles on the furthest stage either way

  Scenario: a field that simply overwrites is caught as order-dependent
    Given a field that takes the value of whichever event was applied last
    And that field carries no stamp saying when its value was set
    When the same events are folded in different orders
    Then the check reports the fold as order-dependent

  Scenario: an order-dependent fold reports how to reproduce the disagreement
    Given a fold that reaches different states under different orders
    When the check reports its finding
    Then it names two orderings that disagree
    And a developer can replay those two orderings by hand

  Scenario: a fold that mutates the state it was handed is reported distinctly
    Given a fold that changes its input state rather than returning a new one
    When the check runs
    Then the report distinguishes that from an ordering disagreement
    And it does so because the cause and the remedy are different

  Scenario: the same fold and events always produce the same verdict
    Given a fold with more events than can be exhaustively permuted
    When the check is run repeatedly against it
    Then every run examines the same orderings
    And every run reaches the same verdict

  Scenario: a large event set is sampled rather than exhaustively permuted
    Given far more events than could be permuted in reasonable time
    When the check runs
    Then it examines a bounded number of orderings
    And it reports how many it examined
