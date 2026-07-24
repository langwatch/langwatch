@regression
Feature: Workflow evaluator input coercion at the executor boundary
  As an experiment author wiring an evaluator block into a Studio workflow
  I want non-string upstream node outputs to reach the evaluator as their string form
  So that a langevals evaluator never rejects a request with
    "Expected string, received boolean" simply because an upstream node emitted a bool

  # The legacy Python Studio executor coerced every evaluator input to the
  # evaluator's declared input type at the workflow boundary (see
  # langwatch_nlp's autoparse_field_value). The Go nlpgo executor never wired
  # that coercion onto its evaluator-block dispatch, so a workflow that
  # composes a boolean-emitting node with a string-input evaluator now
  # surfaces a Pydantic rejection that the Python era hid. This restores
  # parity: the chain is deterministic — coerce at the boundary, scorer
  # decides equality.

  Background:
    Given a Studio workflow that pipes an upstream node output into an evaluator block
    And the evaluator block's input declares the field as a string

  Scenario Outline: Non-string upstream outputs are coerced before dispatch
    Given the upstream node emits "<source_value>" of type "<source_type>"
    When the workflow executor invokes the evaluator block
    Then the evaluator request carries the value as the string "<as_string>"
    And the evaluator does not surface a type-validation rejection

    Examples:
      | source_type | source_value | as_string          |
      | boolean     | true         | true               |
      | boolean     | false        | false              |
      | number      | 42           | 42                 |
      | number      | 0.5          | 0.5                |
      | object      | {"a":1}      | {"a":1}            |
      | array       | [1,2,3]      | [1,2,3]            |

  Scenario: Null upstream values are preserved, not coerced into a string
    Given the upstream node emits null for the evaluator input
    When the workflow executor invokes the evaluator block
    Then the evaluator request omits the field or sends a null value
    And the row is reported as inconclusive rather than rejected
