Feature: The cognitive-complexity lint rule
  A function's SonarSource cognitive complexity — a structural +1 per
  control-flow break plus the current nesting level — is reported by name and
  measured score once it passes the configured maximum.

  @unit
  Scenario: A function past the complexity maximum is reported with its name and score
    Given a function built from a deep if/else chain past the default maximum
    When the cognitive-complexity rule runs over it
    Then it reports tooComplex naming the function and its measured complexity

  @unit
  Scenario: A simple function is left alone
    Given a function with a single if statement
    When the cognitive-complexity rule runs over it
    Then it reports nothing

  @unit
  Scenario: The max option lowers the threshold the rule measures against
    Given a function with a single if statement
    When the cognitive-complexity rule runs with max set to zero
    Then it reports tooComplex
