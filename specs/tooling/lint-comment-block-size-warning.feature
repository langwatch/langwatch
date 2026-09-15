Feature: The comment-block-size-warning lint rule
  A comment block between 6 and 8 lines warns rather than errors, sharing
  the same per-file analysis the error-severity comment-block-size rule
  computes, so a file with both a warned block and an oversized block is
  only walked once between the two rules. This is the one tier a block may
  keep its length in, and `@lint-keep` is a last resort rather than an escape
  hatch: it silences the warning only when it gives a reason and names the ADR
  recording the narrative, so keeping a block costs writing the ADR first.

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

  @unit
  Scenario: A keep annotation naming its ADR silences the warning
    Given a 7-line comment block whose @lint-keep gives a reason and names an ADR
    When the comment-block-size-warning rule runs over it
    Then it reports nothing

  @unit
  Scenario: A keep annotation that records nothing is refused
    Given a 7-line comment block whose @lint-keep gives a reason but names no ADR
    When the comment-block-size-warning rule runs over it
    Then it reports commentKeepReason

  @unit
  Scenario: A keep annotation with no reason is refused
    Given a 7-line comment block carrying a bare @lint-keep annotation
    When the comment-block-size-warning rule runs over it
    Then it reports commentKeepReason asking for the reason

  @unit
  Scenario: A keep annotation whose reason is a single word is refused
    Given a 7-line comment block naming an ADR whose @lint-keep reason is one word
    When the comment-block-size-warning rule runs over it
    Then it reports commentKeepReason
