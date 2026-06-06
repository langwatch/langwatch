@regression
Feature: Exact-match scorer with JavaScript-style loose equality
  As an evaluation author
  I want exact-match to treat numerically- or semantically-equivalent values
    as a match even when one side is a boolean and the other a string
  So that an evaluator-as-target's `passed: true` output can be graded
    against a dataset golden label of "1" without false negatives

  # The scorer has long used a float-equality short-circuit so "1.0" matches
  # "1". The same intuition applies to booleans: an upstream evaluator that
  # emits `passed: true` represents the same answer as a dataset row whose
  # golden label is "1" (or "true"). Without the loose-equality layer the
  # rows score as a mismatch even though the user clearly intends them to
  # match. The semantic lives in the scorer (not in the upstream coercion)
  # so that the value still arrives at the scorer with full fidelity — the
  # match is a scorer decision, not a string-pipeline artifact.

  Background:
    Given the exact-match scorer with default settings

  Scenario Outline: Boolean values match their numeric and string equivalents
    Given the evaluator output is "<output>"
    And the expected output is "<expected>"
    When the row is scored
    Then the row is reported as a match

    Examples:
      | output | expected |
      | true   | 1        |
      | 1      | true     |
      | true   | true     |
      | false  | 0        |
      | 0      | false    |
      | false  | false    |
      | 1.0    | 1        |
      | 1      | 1.0      |

  Scenario Outline: Mismatched values do not falsely match
    Given the evaluator output is "<output>"
    And the expected output is "<expected>"
    When the row is scored
    Then the row is reported as a mismatch

    Examples:
      | output | expected |
      | true   | 0        |
      | false  | 1        |
      | 2      | true     |
      | hello  | true     |
      | true   | hello    |

  Scenario: Non-numeric, non-boolean strings still use the existing transform chain
    Given the evaluator output is "  Hello!  "
    And the expected output is "hello"
    And the scorer is configured to trim whitespace, ignore punctuation, and ignore case
    When the row is scored
    Then the row is reported as a match

  Scenario: The float-equality short-circuit still applies for numeric strings
    Given the evaluator output is "1.50"
    And the expected output is "1.5"
    When the row is scored
    Then the row is reported as a match
