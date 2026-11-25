# Round 16 (.claude/coordinator/rulings-2026-10-07.md): a lane handed over at a lane boundary is
# refolded over the deploy overlap only, never from the start of the log. A projection replay step
# takes a `since` instant; its first run replays every aggregate with an event since that instant,
# each refolded from its whole history, and a resumed run still starts from its last cursor.

Feature: A projection replay step bounded to a cut-over instant
  As a module that takes over a lane another module's release still wrote during the deploy overlap
  I want a replay step that starts at the cut-over instant
  So that the overlap is repaired without refolding or repricing the whole log

  @unit
  Scenario: A first run with a since instant replays the lane from that instant
    Given a projection replay step declared with a since instant
    And the step never ran
    When the worker runs it
    Then the lane is replayed from that instant, not from the start of the log
    And the step reports the cursor it completed through

  @unit
  Scenario: A step declared without a since instant still replays from the start of the log
    Given a projection replay step declared without a since instant
    When the worker runs it for the first time
    Then the lane is replayed from the start of the log

  @unit
  Scenario: A resumed run with a since instant starts from the cursor it last completed through
    Given a projection replay step declared with a since instant that completed through a cursor
    When the worker runs it again
    Then the lane is replayed only from that cursor

  @unit
  Scenario: Progress saves of a bounded run keep the since instant until the run completes
    Given a projection replay step declared with a since instant
    When each batch of its first run completes
    Then the step saves its progress with the since instant as its cursor
