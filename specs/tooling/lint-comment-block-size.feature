Feature: The comment-block-size lint rule
  A contiguous comment block of 9 or more lines, or a comment line past 100
  columns, is reported — comments exist to make code readable and good code
  needs almost none. A block carrying a `@scenario` annotation, or a file the
  burn-down allowlist still covers, is exempt.

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
  Scenario: A file the burn-down root covers is not reported
    Given a committed file with a 9-line comment block whose root is listed in the burn-down allowlist
    When the comment-block-size rule runs over it
    Then it reports nothing
