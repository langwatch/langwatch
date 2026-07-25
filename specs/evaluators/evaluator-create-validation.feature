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

  # ============================================================================
  # The panel: the catalog reads as a catalog, never as the project's evaluators
  # ============================================================================

  # The catalog listing answers "what may I pick", so its rows are evaluator
  # TYPES, not the project's saved evaluators. Read as the latter it says the
  # project has none of them — the empty-state card the whole flow exists to
  # stop, drawn by the very command added to prevent it.

  Scenario: The type catalog renders as a collection
    When the assistant runs "langwatch evaluator types"
    Then the result renders as rows rather than one resource's facts
    And the card is titled in the plural

  Scenario: Catalog types are never looked up as the project's saved evaluators
    When the assistant runs "langwatch evaluator types"
    Then the listed type slugs are not resolved as saved evaluators
    And the card draws the catalog the command returned

  # ============================================================================
  # Instructions: nothing we ship teaches a type the platform rejects
  # ============================================================================

  # The original failure began in our own examples: an agent copied a slug we
  # published and was guaranteed a 422. Correcting the known instances leaves
  # the next one free to appear, so the rule is pinned instead of the values.

  Scenario: No shipped instruction teaches an evaluator type the platform rejects
    Given every evaluator type taught by a skill, the assistant's rules, or the feature map
    Then each one is present in the platform's evaluator catalog

  Scenario: The assistant is pointed at the catalog rather than the project's evaluators
    Given the assistant's rules name the commands for an evaluation request
    Then choosing a type is directed at the catalog listing
    And listing the project's saved evaluators is not a step in creating one

  # ============================================================================
  # The ambiguous ask is a question card, not prose
  # ============================================================================

  Scenario: An ambiguous evaluation request is asked as a choices block
    Given a request that names neither a dataset nor live traffic
    Then the router asks with a choices block offering the two options
    And nothing is created before the answer arrives

  # ============================================================================
  # The same recovery over MCP
  # ============================================================================

  # An agent on the MCP surface reads the same rejection and must be able to
  # act on it, or the advice "pick one of the types in this error's expected
  # list" names a list it was never given.

  Scenario: A rejection over MCP carries the accepted types
    When a tool call fails validation with an expected list
    Then the error surfaced to the caller carries those reasons

  # Not yet: the MCP schema listing reads the generated langevals catalog only,
  # while the create route accepts that catalog merged with the natively
  # executed evaluators. Closing it means giving the MCP image the native
  # module the CLI already carries, so it lands with that build change.
  @unimplemented
  Scenario: The MCP evaluator catalog matches the one the API accepts
    When I discover the evaluator schemas over MCP
    Then the natively executed evaluators are listed alongside the rest
