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

  @unit
  Scenario: A refused command leaves no audit row
    Given an operator commands the connection ledger and the ledger refuses the command
    When the back office reports the refusal
    Then no audit row is written for that command

  @unit
  Scenario: A command that succeeds is recorded once, after it ran
    Given an operator commands the connection ledger
    When the ledger completes the command
    Then exactly one audit row is written
    And it is written after the ledger answered

  @unit
  Scenario: Without a license the provider is not offered
    Given a configured federation provider with its credentials, on a deployment nothing licenses
    When the SSO gate resolves the provider
    Then it returns email, so the sign-in page never offers federation
    And the deployment reports federation as not allowed

  @unit
  Scenario: A configured process serves the back office's connection ledger
    Given a process that installed single sign-on
    When the back office asks it for a page of connections
    Then the answer comes from the connection ledger the process was given
    And nothing about that page is served from anywhere else

  @integration
  Scenario: Starting sign-in sends the browser to the identity provider
    Given a deployment federating to an identity provider that published a discovery document
    When somebody starts sign-in
    Then they are sent to the authorization endpoint the issuer published, which is
      not the issuer's own address
    And the request carries the client id, the openid, email and profile scopes,
      the registered redirect address and an authorization-code response type
