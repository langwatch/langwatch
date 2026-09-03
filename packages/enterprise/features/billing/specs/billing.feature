Feature: Enterprise billing compatibility

  @unit
  Scenario: Resolve a portable SaaS plan
    Given Billing receives an active subscription and explicit plan overrides
    When the plan service resolves the organization's plan
    Then it returns the same plan type and limits as the legacy Billing module

  @unit
  Scenario: Report metered usage through an injected provider
    Given a Billing meter and Stripe adapter are composed
    When usage is reported for an organization and billing month
    Then the same idempotency key, event value, and failure semantics are used

  @unit
  Scenario: Keep browser pricing backend-free
    Given the Billing web package renders or formats pricing
    When its dependency graph is inspected
    Then it imports no Stripe SDK, Prisma client, server package, or application source
