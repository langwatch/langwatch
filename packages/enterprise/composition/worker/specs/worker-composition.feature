Feature: Enterprise worker composition

  @unit
  Scenario: Create the worker composition with explicit feature ports
    Given the worker supplies a project/organisation read, managed-provider configuration, and credential ports
    When the Enterprise worker composition is created
    Then it exposes the portable catalogue without installing a feature
    And it exposes the managed-provider capability

  @unit
  Scenario: Managed provider execution uses the composed worker capability
    Given a project resolves to a configured managed-provider organization
    When the worker prepares Bedrock LiteLLM parameters
    Then it uses the injected credentials port
    And it does not read environment variables

  Scenario: Import worker composition safely
    When the worker composition package is imported
    Then no queues, jobs, API routes, or web surfaces are registered
