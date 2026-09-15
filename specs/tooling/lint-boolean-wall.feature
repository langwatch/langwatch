Feature: The boolean-wall lint rule
  A logical expression with more than three leaf conditions is a wall an
  agent has to parse operator by operator. The rule reports the measured
  leaf count next to the fix.

  @unit
  Scenario: A boolean wall is reported with its measured leaf count
    Given a logical expression with four leaf conditions
    When the boolean-wall rule runs over it
    Then it reports booleanWall with the leaf count it measured
    And the message tells the reader to name a group of them as a const

  @unit
  Scenario: A condition within the leaf limit is left alone
    Given a logical expression with three leaf conditions
    When the boolean-wall rule runs over it
    Then it reports nothing
