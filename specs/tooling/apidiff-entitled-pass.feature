# Bound by Go tests in tools/apidiff (`go test ./...`), annotated `// @scenario`.
Feature: apidiff re-probes Enterprise-gated operations with a licence

  As a developer diffing a branch against main
  I want operations the Enterprise gate refused re-probed on licensed stacks
  So that a gated route is compared on what it does, not only on its refusal

  @unit
  Scenario: The entitled pass skips an operation nothing gated
    Given a run where no operation hit the Enterprise gate
    When the entitled pass runs
    Then nothing is activated and nothing is re-probed

  @unit
  Scenario: The entitled pass skips honestly when no database is available to activate
    Given an operation the main pass saw the Enterprise gate refuse
    And no activator, because no database is available to write a licence into
    When the entitled pass runs
    Then it reports that it skipped, and why, rather than claiming a comparison

  @unit
  Scenario: The entitled pass re-probes a gated operation and keeps the unentitled refusal as its own finding
    Given the candidate gates an operation the base never gated
    When the entitled pass activates a licence on both sides and re-probes it
    Then the entitled answers are compared
    And the refusal the unentitled pass saw is kept as a finding of its own

  @unit
  Scenario: The entitled pass reports honestly when activation does not fix the gated side
    Given the candidate keeps refusing after its licence is activated
    When the entitled pass re-probes the operation
    Then the asymmetry is reported as it is, not as a pass

  @unit
  Scenario: The entitled pass copies the licence the branch seed signed onto both databases
    Given the branch seed stored a signed licence
    When the entitled pass activates
    Then that same licence is written into both instances' databases

  @unit
  Scenario: The entitled pass is deferred on both sides when no licence keys are configured
    Given the branch seed stored no licence, because no licence keys are configured
    When the entitled pass would activate
    Then it is deferred on both sides and says so

  @unit
  Scenario: The entitled pass reaches haven stacks through haven db url
    Given both instances are haven stacks
    When the entitled pass activates
    Then each stack's database is reached through "haven db url" for that stack's slug
