Feature: The spend reconciliation routes gate on their own credential's organization
  ADR-072. The billing-events plan check runs as transport-fact middleware
  behind the organization door the spend-events, spend-summaries and replay
  routes declare; it must read that same door's organization, not a context
  variable no door here ever sets.

  @unit
  Scenario: The spend-plan gate reads the credential door's own organization
    Given a request the organization credential door resolved
    When the spend-plan gate reads the organization to check the plan against
    Then it reads the organization the door recorded for that request

  @unit
  Scenario: The spend-plan gate refuses to gate on a blank organization
    Given a request no credential door resolved
    When the spend-plan gate reads the organization to check the plan against
    Then it throws rather than checking the plan for every organization
