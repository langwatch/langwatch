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
  Scenario: The fix sends the extracted block to module level
    Given a function past the default maximum
    When the cognitive-complexity rule runs over it
    Then the fix says to extract the heaviest block into a module-level function
    And it says a nested closure would still count toward the function

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

  # Attribution is by the weight of a whole block, not by the single node with
  # the largest delta. The two answers differ whenever nesting is spread thin,
  # and the second one named leaves nobody should extract.
  @unit
  Scenario: The block carrying the most of the score is named, not a leaf that ties on its own delta
    Given a function whose score is spread over many nested constructs
    When the cognitive-complexity rule runs over it
    Then it names the block carrying the largest share and reports that share

  @unit
  Scenario: A block accounting for the whole score is never the named target
    Given a function whose entire body sits inside one loop
    When the cognitive-complexity rule runs over it
    Then it names a block inside the loop rather than the loop itself

  @unit
  Scenario: A score with no dominant block is reported as spread rather than given a target
    Given a function whose largest block carries less than a third of its score
    When the cognitive-complexity rule runs over it
    Then it reports tooComplexSpread and asks for the nesting to come down
