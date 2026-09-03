Feature: Enterprise SSO package boundary
  The application explicitly composes portable SSO policy and server adapters.

  @unit
  Scenario: A signed license enables a mounted provider
    Given a configured non-email provider and a signature-valid license reported by the Licensing service
    When the SSO gate resolves the provider
    Then it returns the configured provider

  @unit
  Scenario: A failed license-store evaluation is retried
    Given the shared Licensing service fails during an SSO gate evaluation
    When a later request evaluates the gate again
    Then the Licensing service is queried again rather than caching the failure

  @architecture
  Scenario: SSO does not reimplement licensing
    Given SSO needs to decide whether a self-hosted platform is licensed
    When the SSO gate is composed
    Then it receives the shared Licensing service contract
    And SSO owns no license verifier or license repository

  @unit
  Scenario: A provider without credentials falls back to email
    Given SSO is licensed but the configured provider cannot be mounted
    When the SSO gate resolves the provider
    Then it returns email
