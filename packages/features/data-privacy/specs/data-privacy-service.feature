Feature: Data Privacy service

  Scenario: The service resolves the platform default
    Given a project with no data privacy rules
    When the data privacy service resolves the project policy
    Then content is captured
    And essential PII redaction is enabled
    And secrets redaction is enabled

  Scenario: The nearest scope wins while patterns accumulate
    Given an organization rule and a narrower team rule
    When the data privacy service resolves a project in that team
    Then the team rule supplies fields it sets
    And custom patterns from both rules are applied

  Scenario: Unsafe customer patterns are rejected before persistence
    Given a data privacy rule with an invalid or unsafe regular expression
    When the rule is saved
    Then the service rejects the rule
    And no policy row is written
