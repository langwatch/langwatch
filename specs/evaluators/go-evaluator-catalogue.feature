Feature: The Go evaluator runtime owns the evaluator catalogue
  The evaluator definitions, their settings and their defaults live in Go.
  The TypeScript catalogue the product and SDKs read is generated from them.
  Plan: dev/docs/plans/langevals-go-replacement.md §7.

  @unit
  Scenario: The generated catalogue matches the one langevals generated
    Given the Go definitions of every evaluator
    When the catalogue is generated
    Then it is byte for byte the committed evaluators.generated.ts

  @unit
  Scenario: Every evaluator in the catalogue has a Go definition
    Given the evaluators the catalogue lists
    Then each one has a Go definition with its settings and required fields

  @unit
  Scenario: Settings a request leaves out take their defaults
    Given an evaluator whose settings have defaults
    When a request sends settings without some of those fields
    Then the evaluator runs with the defaults for the missing fields

  @unit
  Scenario: Settings of the wrong type are refused
    Given an evaluator with a numeric setting
    When a request sends text for that setting
    Then the request is refused as invalid settings
    And no model is called

  @unit
  Scenario: A setting outside its allowed values is refused
    Given an evaluator whose setting accepts a fixed set of values
    When a request sends a value outside that set
    Then the request is refused as invalid settings
