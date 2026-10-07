Feature: Lent tokens live in their owner's client, wave 2
  Workflow, model-provider, experiment, agent, analytics, annotation and
  managed-provider lend their components by tokens declared in their own client
  packages. A reader imports the token from that client and renders it, without
  importing the owner's browser package (ARCHITECTURE.md §10.1).

  @unit
  Scenario: Each wave 2 owner lends its components by its client tokens
    Given the workflow, model-provider, experiment, agent, analytics, annotation and managed-provider browsers are installed
    When a reader looks up each token from its owner's client
    Then the owner's lent component loads for it

  @integration
  Scenario: Evaluator renders workflow's clamped text through its client token
    Given workflow lends its hoverable big text token
    When evaluator's sample list renders a long trace output
    Then workflow's clamped text renders the output

  @integration
  Scenario: An uninstalled workflow leaves evaluator's plain text
    Given no installed module lends the hoverable big text token
    When evaluator's sample list renders a long trace output
    Then the output renders as plain text and nothing fails

  @integration
  Scenario: An uninstalled workflow leaves the trace field unmarked
    Given no installed module lends the redacted field token
    When evaluator renders a trace field through the redacted field
    Then the field itself renders and nothing fails

  @integration
  Scenario: Governance renders model-provider's model picker through its client token
    Given model-provider lends its model selector token
    When governance's insights setup renders a model picker
    Then model-provider's picker renders with the governance options
