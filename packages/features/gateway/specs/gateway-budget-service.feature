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

  Scenario: A cache-rule mutation refreshes the Gateway configuration atomically
    Given an active cache rule for an organization
    When the rule is created, updated, or archived
    Then its row mutation, Gateway change event, and audit record use one persistence transaction

  Scenario: A configuration bundle includes only eligible persistence records
    Given an organization has enabled and archived cache rules and a virtual key targets a trace project
    When the Gateway materialises its configuration bundle
    Then it includes only enabled non-archived cache rules and guardrail attachments present in that project catalogue
