Feature: The comment-block-size-warning lint rule
  A comment block between 6 and 8 lines warns rather than errors, sharing
  the same per-file analysis the error-severity comment-block-size rule
  computes, so a file with both a warned block and an oversized block is
  only walked once between the two rules.

  @unit
  Scenario: A mid-size comment block is warned about with the measured count
    Given a source file with a 7-line comment block
    When the comment-block-size-warning rule runs over it
    Then it reports commentBlockSize with the measured line count and the maximum

  @unit
  Scenario: An oversized block is left to the error-severity rule
    Given a source file with a 9-line comment block
    When the comment-block-size-warning rule runs over it
    Then it reports nothing
