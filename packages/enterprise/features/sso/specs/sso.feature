Feature: Enterprise SSO package boundary
  The application explicitly composes portable SSO policy and server adapters.

  @unit
  Scenario: A signed license enables a mounted provider
    Given a configured non-email provider and a signature-valid license
    When the SSO gate resolves the provider
    Then it returns the configured provider

  @unit
  Scenario: A failed license-store evaluation is retried
    Given the license store fails during an SSO gate evaluation
    When a later request evaluates the gate again
    Then the store is queried again rather than caching the failure

  @unit
  Scenario: A provider without credentials falls back to email
    Given SSO is licensed but the configured provider cannot be mounted
    When the SSO gate resolves the provider
    Then it returns email
