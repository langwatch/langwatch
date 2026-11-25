Feature: The comment-block-size lint rule
  A contiguous comment block of 6 or more lines of commentary, or a comment
  line past 100 columns, is reported — comments exist to make code readable and
  good code needs almost none. There is one tier, it is an error, and nothing
  suppresses it: a `@lint-keep` line is commentary like any other. A block
  carrying a `@scenario` annotation is exempt, and lines the author cannot cut —
  structural JSDoc tags, and the annotations that select a test's level and
  environment — are not counted as commentary.

  @unit
  Scenario: An oversized comment block is reported with its measured line count
    Given a source file with a 9-line comment block
    When the comment-block-size rule runs over it
    Then it reports the block's measured line count against the maximum

  @unit
  Scenario: An overlong comment line is reported with its measured width
    Given a source file with a comment line past 100 columns
    When the comment-block-size rule runs over it
    Then it reports commentColumns with the measured width

  @unit
  Scenario: A comment block under the size thresholds is left alone
    Given a source file with a 2-line comment block
    When the comment-block-size rule runs over it
    Then it reports nothing

  @unit
  Scenario: A scenario-bound comment block is exempt from the size limit
    Given a 9-line comment block carrying a @scenario annotation
    When the comment-block-size rule runs over it
    Then it reports nothing

  @unit
  Scenario: The keep annotation does not suppress the error
    Given an 8-line comment block whose @lint-keep gives a reason and names an ADR
    When the comment-block-size rule runs over it
    Then it reports the block

  @unit
  Scenario: A keep annotation's lines count as commentary
    Given five lines of prose followed by two @lint-keep lines, starting on line 2
    When the comment-block-size rule runs over it
    Then it reports a 7-line block on line 2

  @unit
  Scenario: A five-line block is at the maximum and passes
    Given a source file with a 5-line comment block
    When the comment-block-size rule runs over it
    Then it reports nothing

  @unit
  Scenario: An overlong scenario binding is not reported
    Given a comment line past 100 columns carrying a @scenario annotation
    When the comment-block-size rule runs over it
    Then it reports nothing, because rewrapping the title would unbind the test

  @unit
  Scenario: Structural JSDoc tags are not counted as commentary
    Given a comment block whose length is its @param and @returns tags
    When the comment-block-size rule runs over it
    Then it reports nothing, because the tag count comes from the signature

  @unit
  Scenario: A test's level and environment annotations are not counted as commentary
    Given a comment block whose length is one line of prose beside @integration and @vitest-environment
    When the comment-block-size rule runs over it
    Then it reports nothing, because neither annotation can be deleted by its author

  @unit
  Scenario: Prose past the limit is still reported alongside tags
    Given a comment block carrying nine lines of narrative beside one @param tag
    When the comment-block-size rule runs over it
    Then it reports the block, counting only the commentary
