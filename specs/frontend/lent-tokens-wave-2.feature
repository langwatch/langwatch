Feature: Lent tokens live in their owner's client, wave 2
  Workflow, model-provider, experiment, agent, analytics, annotation and
  managed-provider lend their components by tokens declared in their own client
  packages. A reader imports the token from that client and renders it, without
  importing the owner's browser package (ARCHITECTURE.md §10.1).

  @unit @unimplemented
  Scenario: Each wave 2 owner lends its components by its client tokens
    Given the workflow, model-provider, experiment, agent, analytics, annotation and managed-provider browsers are installed
    When a reader looks up each token from its owner's client
    Then the owner's lent component loads for it

  @integration @unimplemented
  Scenario: Evaluator renders workflow's clamped text through its client token
    Given workflow lends its hoverable big text token
    When evaluator's sample list renders a long trace output
    Then workflow's clamped text renders the output

  @integration @unimplemented
  Scenario: An uninstalled workflow leaves evaluator's plain text
    Given no installed module lends the hoverable big text token
    When evaluator's sample list renders a long trace output
    Then the output renders as plain text and nothing fails

  @integration @unimplemented
  Scenario: An uninstalled workflow leaves the redacted field's loading state
    Given no installed module lends the redacted field token
    When a screen renders a trace field through the redacted field
    Then the reader's loading component renders and nothing fails

  @integration @unimplemented
  Scenario: Governance renders model-provider's model picker through its client token
    Given model-provider lends its model selector token
    When governance's settings render a model picker
    Then model-provider's picker renders with the governance options

  @integration @unimplemented
  Scenario: Model-provider renders managed-provider's alert through its client token
    Given managed-provider lends its managed model provider alert token
    When the credentials section shows a managed provider
    Then managed-provider's alert renders above the credentials

  @integration @unimplemented
  Scenario: An uninstalled managed-provider leaves the credentials section without an alert
    Given no installed module lends the managed model provider alert token
    When the credentials section shows a provider
    Then no alert renders and the credentials still render
