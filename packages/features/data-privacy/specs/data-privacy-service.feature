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

  @unit
  Scenario: Unsafe customer patterns are rejected before persistence
    Given a data privacy rule with an invalid or unsafe regular expression
    When the rule is saved
    Then the service rejects the rule
    And no policy row is written

  Rule: A refusal a reader can act on says what happened

    A privacy rule is saved from a settings page whose scope picker can go
    stale under the reader: a team is renamed, a department archived, a project
    moved to another organization. Every one of those refusals names itself, so
    the page can tell the reader what to do instead of showing an unexplained
    failure.

    @integration
    Scenario: A rule aimed at a scope that no longer exists is refused by name
      Given the organization, department, team or project a rule was aimed at has been removed
      When the reader saves the rule
      Then the save is refused as a missing scope
      And the reader is told to reload the page and pick a scope that is still there

    @unit
    Scenario: A rule aimed outside the project's organization is refused by name
      Given the scope a rule was aimed at belongs to a different organization than the project
      When the reader saves the rule
      Then the save is refused as an out-of-organization scope
      And the reader is told to pick a scope in this organization

    @unit
    Scenario: A rule written from a project that is gone is refused by name
      Given the project the privacy settings were opened from has been removed
      When the reader saves the rule
      Then the save is refused as a missing project

    @unit
    Scenario: A caller without standing at a tier is told which permission it needs
      Given a reader who may change their own project but not the organization
      When they save a rule at the organization
      Then the save is refused
      And the refusal names the permission that tier asks for

    @integration
    Scenario: A rule whose pattern is refused says which pattern and why
      Given a rule carrying a custom pattern that also matches ordinary text
      When the reader saves the rule
      Then the save is refused as an invalid rule
      And the reader is told which pattern was rejected and why

    @unit
    Scenario: A rule aimed at a department is refused by name
      Given a reader who picked a department in the scope picker
      When they save the rule
      Then the save is refused as a tier that cannot carry a rule
      And the reader is told to set the rule on the organization, a team or a project instead
      And the reader is told to check their custom patterns and exceptions
      And no policy row is written
