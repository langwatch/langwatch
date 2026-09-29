Feature: Gateway budget decision service

  @unit
  Scenario: A projected request reaches a hard budget limit
    Given an applicable BLOCK budget with 0.50 USD spent and a 1.00 USD limit
    When the Gateway checks a projected cost of 0.50 USD
    Then it returns decision "hard_block"
    And it includes blockedBy and scopes with the existing wire fields

  @unit
  Scenario: Provider-filtered budgets only apply to their provider
    Given an applicable budget filtered to the OpenAI provider
    When the Gateway checks a request for another provider
    Then that budget is absent from the scopes response

  Scenario: The process owns one budget decision service
    Given the API, CLI, and Gateway routes use the application instance
    When multiple requests perform budget checks
    Then they share the same Gateway service and repository instances

  @unit
  Scenario: A cache-rule mutation refreshes the Gateway configuration atomically
    Given an active cache rule for an organization
    When the rule is created, updated, or archived
    Then its row mutation, Gateway change event, and audit record use one persistence transaction

  @unit
  Scenario: A configuration bundle includes only eligible persistence records
    Given an organization has enabled and archived cache rules and a virtual key targets a trace project
    When the Gateway materialises its configuration bundle
    Then it includes only enabled non-archived cache rules and guardrail attachments present in that project catalogue

  @unit
  Scenario: A budget's spend and recent ledger read across its organisation's projects under the tenant guard
    Given a budget whose organisation has two projects writing to the ledger
    When its detail reads the recent ledger, the spend per target and the spend per bucket
    Then each read is one statement declaring both projects as its tenant set, which the tenant guard accepts

  @unit
  Scenario: A budget whose organisation has no projects reads no ledger
    Given a budget whose organisation has no projects
    When its detail reads the recent ledger and its spend
    Then each read answers empty without sending a statement

  @integration
  Scenario: A budget listing carries each row's scope reach
    Given a page of budgets, one of which no active key can reach
    When the budget list is answered
    Then each row carries scope_reach from the same per-row reach read the detail route uses

  @integration
  Scenario: A budget reset answers with the row it moved, carrying no reach read
    Given a budget whose period is reset
    When the reset answers with the row it moved
    Then the answer carries no scope_reach field
