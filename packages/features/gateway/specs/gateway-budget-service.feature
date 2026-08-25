Feature: Gateway budget decision service

  Scenario: A projected request reaches a hard budget limit
    Given an applicable BLOCK budget with 0.50 USD spent and a 1.00 USD limit
    When the Gateway checks a projected cost of 0.50 USD
    Then it returns decision "hard_block"
    And it includes blockedBy and scopes with the existing wire fields

  Scenario: Provider-filtered budgets only apply to their provider
    Given an applicable budget filtered to the OpenAI provider
    When the Gateway checks a request for another provider
    Then that budget is absent from the scopes response

  Scenario: The process owns one budget decision service
    Given the API, CLI, and Gateway routes use the application instance
    When multiple requests perform budget checks
    Then they share the same Gateway service and repository instances
