Feature: LangWatch as an upstream provider for a self-hosted gateway
  A self-hosted gateway can forward OpenAI-compatible calls to the LangWatch
  gateway as one more upstream provider. The call carries the license token and
  the instance id, and it is metered on the LangWatch side against the same
  organization budget as every other hosted service.

  This delivers the provider and its entitlement only. Choosing a model by
  evaluation results is not part of it.

  As the operator of a connected self-hosted install
  I want my gateway to reach LangWatch-managed models with the license I already hold
  So that I need no provider account of my own for them

  Background:
    Given a self-hosted gateway with a "langwatch" provider pointed at the LangWatch gateway endpoint
    And a registered license entitled to "managed_models"

  # ============================================================================
  # The install's gateway
  # ============================================================================

  @integration
  Scenario: A call routed to the langwatch provider is served by the LangWatch gateway
    When a chat completion for model "langwatch/gpt-5-mini" arrives at the self-hosted gateway
    Then it is forwarded to the LangWatch gateway as model "gpt-5-mini"
    And the forwarded call carries the license token and the instance id
    And the response is returned to the caller unchanged

  @unit
  Scenario: The langwatch prefix is read as a provider, not as part of a model name
    When a request names model "langwatch/gpt-5-mini"
    Then the provider is "langwatch" and the model is "gpt-5-mini"

  @integration
  Scenario: Forwarded calls are metered under the customer organization
    When a call is forwarded and answered
    Then the LangWatch side records its spend under the customer organization and the managed key of that license
    And it counts against the same budget as Instant Evals

  @unit
  Scenario: A license without the managed models entitlement is refused
    Given the license is not entitled to "managed_models"
    When a call is forwarded to the LangWatch gateway
    Then it is refused with code "connect_service_not_entitled"

  @integration
  Scenario: A spent budget stops forwarded calls
    Given the customer organization has spent its budget
    When a call is forwarded to the LangWatch gateway
    Then the caller of the self-hosted gateway receives status 402

  @unit
  Scenario: The license token is never written to logs or traces
    When a call is forwarded
    Then neither gateway writes the license token to its logs or spans

  @unit
  Scenario: The provider refuses an endpoint that is not HTTPS
    Given the "langwatch" provider is configured with a plain HTTP endpoint outside local development
    When a call is routed to it
    Then the call is refused because the license token would travel unencrypted

  @unit
  Scenario: A streamed completion is forwarded as a stream
    When a streamed chat completion is routed to the langwatch provider
    Then the chunks reach the caller as they arrive

  # ============================================================================
  # What the install configures
  # ============================================================================

  @unit
  Scenario: The install adds the LangWatch provider only when Connect and the service are on
    Given an organization that has switched "managed_models" on
    When the install materialises the configuration of one of its virtual keys
    Then a "langwatch" provider carrying the license token and the instance id is added after the organization's own providers
    But an install with Connect switched off, or an organization that has not switched the service on, gets no such provider

  @unit
  Scenario: Managed models is listed in Settings, Connect with what it sends
    When an admin opens Settings, Connect
    Then "Managed models" is listed as a hosted service that starts switched off
    And its entry states that the prompts and completions of calls routed to a langwatch model are sent to LangWatch
    And it states that nothing else leaves the install

  # ============================================================================
  # LangWatch Cloud
  # ============================================================================

  @integration
  Scenario: The resolved license key carries the license's hosted services
    When a gateway resolves the license token
    Then the answer names the services the license is entitled to

  @unit
  Scenario: An entitled license key resolves to the platform's shared providers
    Given the license is entitled to "managed_models"
    When the managed key's eligible providers are resolved
    Then they are the providers the platform holds its own keys for
    And a license without the entitlement resolves to none

  @integration
  Scenario: The configuration of an entitled license key lists the platform's shared providers
    When the managed key's configuration is materialised
    Then it carries the platform's shared providers
    And the configuration of a key whose license lacks the entitlement carries none
