# The lint half of specs/dependencies/plan-catalogue.feature: that spec owns
# what the catalogue states, this one owns the rule that keeps a second
# statement of the same facts out of everything else.

Feature: The linter keeps plan facts in one catalogue
  As a platform maintainer
  I want the linter to refuse a second plan definition
  So that no two parts of the product can quote a customer different numbers

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: An object stating two or more limit fields is a plan definition

    @unit
    Scenario: An object stating two limit fields is reported
      Given production source with an object assigning a member ceiling and a message ceiling
      When the rule runs
      Then it reports the literal and names both fields

    @unit
    Scenario: The message names the catalogue accessor
      Given production source with a second plan definition
      When the rule runs
      Then the message names the plans package and the accessor that answers instead

    @unit
    Scenario: An object stating one limit field is left alone
      Given production source with an object assigning a single limit field
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A price table beside another limit is reported
      Given production source with an object assigning both a period price and a seat price
      When the rule runs
      Then it reports the literal

    @unit
    Scenario: Computed keys are not read as limit fields
      Given production source with an object whose keys are computed
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: The message names the declaration the literal sits on
      Given production source with a named constant holding a plan definition
      When the rule runs
      Then the message names the constant

  Rule: The catalogue, tests and the debt register are outside the rule

    @unit
    Scenario: The plans package states its own facts
      Given a source file in the plans package
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: Test files keep their plan fixtures
      Given a test file with a plan fixture
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A file on the debt register is left alone
      Given a file carrying a plan-literals baseline entry
      When the rule runs
      Then it reports nothing
