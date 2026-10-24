Feature: A catch does not turn a failure into absence
  A catch that reads `.code` (or asks `XError.is(error)`) to decide "this failure means absent"
  and answers null turns an exception into a value on the caller's behalf, and every caller
  repeats the lookup-and-swallow. The owner answers absence itself: call its `find*` and read []
  (ADR-146). Shrink-only: tests/baselines/code-catch-to-null.json holds each file's count.

  See dev/docs/plans/platform-architecture-blocks.md rule 7d (Alex, 2026-10-20).

  @unit @architecture
  Scenario: A code-comparing catch that answers null is reported
    Given a catch clause, a catch chain and a ternary handler that compare .code to a string and answer null or undefined
    When the code-catch-to-null policy reads module code
    Then it reports each of the three

  @unit @architecture
  Scenario: A catch asking XError.is that answers null is reported
    Given a catch clause that tests NotFoundError.is on the caught error and returns null
    When the code-catch-to-null policy reads module code
    Then it reports it

  @unit @architecture
  Scenario: The report asks for the owner's find
    Given a catch that compares .code and answers null
    When the code-catch-to-null policy reports it
    Then the finding tells it to call the owner's find* and read an empty list

  @unit @architecture
  Scenario: A catch that rethrows, maps or answers a value is accepted
    Given catches that answer a fallback value, test instanceof, or throw another error for the code
    When the code-catch-to-null policy reads module code
    Then it reports nothing

  @unit @architecture
  Scenario: A test file is left alone
    Given a test file with a code-comparing catch that answers null
    When the code-catch-to-null policy reads module code
    Then it reports nothing

  @unit @architecture
  Scenario: No file gains a code-tested catch that answers null
    Given the tree's catches that test a code and answer null
    When the catches are counted per file
    Then none is above tests/baselines/code-catch-to-null.json and every listed count is still reached
