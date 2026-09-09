# ADR-135 records why every house rule exists and which layer it lives in.
# A record nobody checks goes stale in a week, so the record itself is
# enforced: every rule the three registries hold has a decision row in an ADR
# and a spec, and every row names a rule that still exists.

Feature: Every lint rule is recorded, and every record names a live rule
  As a platform maintainer
  I want the rule registries, the ADR decision tables and the tooling specs to agree
  So that a rule cannot be added without a reason or deleted without a trace

  Background:
    Given the rules in the langwatch plugin, the ast-grep directory and the architecture-lint policy registry

  Rule: The committed tree agrees with itself

    @unit
    Scenario: Every registered rule has a decision row in an ADR
      Given the committed ADRs under dev/docs/adr
      When the drift guard reads their decision tables
      Then every registered rule id has a row

    @unit
    Scenario: Every registered rule has a spec record
      Given the committed feature files under specs/tooling
      When the drift guard resolves each rule to its spec
      Then every registered rule id has one

    @unit
    Scenario: Every decision row names a rule that exists
      Given the committed ADRs under dev/docs/adr
      When the drift guard compares their rows against the registries
      Then no row names a rule the registries do not hold

  Rule: A missing record is reported by name

    @unit
    Scenario: A rule with no decision row is reported
      Given a registry holding a rule that no ADR table mentions
      When the drift guard runs
      Then it names the rule and says it has no ADR decision row

    @unit
    Scenario: A decision row for a deleted rule is reported
      Given an ADR table row naming a rule no registry holds
      When the drift guard runs
      Then it names the rule and says the ADR row has no rule

    @unit
    Scenario: A rule with no spec is reported
      Given a registry holding a rule with no feature file and no Rule block
      When the drift guard runs
      Then it names the rule and says it has no spec record

  Rule: An ast-grep rule keeps a fixture, so it cannot go dead unnoticed

    @unit
    Scenario: Every ast-grep rule has a fixture with a refused and an accepted case
      Given the rules and fixtures under dev/lint/ast-grep
      When the fixture gate runs
      Then every rule id has a fixture holding at least one refused and one accepted case

    @unit
    Scenario: A fixture naming no rule is reported
      Given the fixtures under dev/lint/ast-grep/rule-tests
      When the fixture gate runs
      Then every fixture names a rule the rules directory declares
