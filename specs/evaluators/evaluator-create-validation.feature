@unit
Feature: Creating an evaluator with an unknown type is recoverable
  As an agent or developer creating an evaluator through the API or CLI
  I want a rejected evaluator type to name the types that would have been accepted
  So that I can correct the request myself instead of guessing or giving up

  # The failure this spec pins: an agent asked for an evaluator with a type
  # slug that does not exist in the catalog (e.g. "ragas/answer_relevancy",
  # a stale name for what is now "ragas/response_relevancy"). The API said
  # 422 validation_error but named only the offending field — not what it
  # would have accepted — so the error's own "fix the fields and retry"
  # advice was impossible to follow.

  # ============================================================================
  # API: the 422 carries the accepted types as data
  # ============================================================================

  Scenario: Unknown evaluator type is rejected naming the exact field
    When I create an evaluator with type "ragas/answer_relevancy"
    Then the request fails as a validation error
    And the offending field is named as "config.evaluatorType"

  Scenario: The rejection lists every type that would have been accepted
    When I create an evaluator with type "ragas/answer_relevancy"
    Then the failure's reason carries the accepted evaluator types as data
    And the accepted types include "ragas/response_relevancy"
    And the accepted types include "legacy/ragas_answer_relevancy"
    And the rejected value is echoed back alongside them

  Scenario: The accepted types stay out of the prose message
    When I create an evaluator with type "ragas/answer_relevancy"
    Then the message stays one short sentence
    And the accepted types appear only as structured data

  Scenario: A schema can hand its accepted set to any validation failure
    Given a route schema that validates a field against a catalog lookup
    When a request fails that validation
    Then the failure's reason carries the schema's accepted set and the received value

  # ============================================================================
  # CLI: an unknown type never reaches the network
  # ============================================================================

  Scenario: The CLI rejects an unknown evaluator type before calling the API
    When I run "langwatch evaluator create 'Relevancy' --type ragas/answer_relevancy"
    Then the command fails without making any API call
    And the error names the closest matching types, including "ragas/response_relevancy"
    And the error points at the command that lists all types

  Scenario: The CLI accepts every type the platform's catalog accepts
    When I run "langwatch evaluator create 'Relevancy' --type ragas/response_relevancy"
    Then the create request is sent with that evaluator type

  Scenario: Valid evaluator types can be listed without touching the API
    When I run "langwatch evaluator types"
    Then I see every evaluator type with its slug, name, and category
    And no API key is required
